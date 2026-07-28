const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Middleware de autenticação admin
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Login page
router.get('/', (req, res) => {
  if (req.session.isAdmin || req.session.isReviewer) {
    if (req.session.isAdmin) return res.redirect('/admin/dashboard');
    if (req.session.isReviewer) return res.redirect('/reviewer');
  }
  res.render('login', {
    error: null,
    year: new Date().getFullYear()
  });
});

// Dashboard admin
router.get('/dashboard', requireAuth, (req, res) => {
  const totalEvents = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
  const publishedEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'published'").get().count;
  const totalArticles = db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
  const activeReviewers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_reviewer = 1 AND is_public = 1').get().count;
  const inactiveReviewers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_reviewer = 1 AND is_public = 0').get().count;
  const recentArticles = db.prepare(`
    SELECT a.*, e.name as event_name
    FROM articles a
    JOIN events e ON a.event_id = e.id
    ORDER BY a.created_at DESC
    LIMIT 10
  `).all();
  
  res.render('admin/dashboard', {
    title: 'Dashboard',
    totalEvents,
    publishedEvents,
    totalArticles,
    activeReviewers,
    inactiveReviewers,
    recentArticles,
    year: new Date().getFullYear()
  });
});

// Login POST - unificado por email e senha
router.post('/', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.render('login', {
      error: 'Todos os campos são obrigatórios.',
      year: new Date().getFullYear()
    });
  }
  
  const bcrypt = require('bcryptjs');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').bind(email).get();
  
  if (!user) {
    return res.render('login', {
      error: 'Credenciais inválidas.',
      year: new Date().getFullYear()
    });
  }
  
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.render('login', {
      error: 'Credenciais inválidas.',
      year: new Date().getFullYear()
    });
  }
  
  // Verificar se o usuário tem permissão pública
  if (!user.is_public) {
    return res.render('login', {
      error: 'Conta desativada.',
      year: new Date().getFullYear()
    });
  }
  
  // Definir roles na sessão baseado nas permissões do usuário
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.userRoles = [];
  
  if (user.is_admin) {
    req.session.isAdmin = true;
    req.session.userRoles.push('admin');
  }
  
  if (user.is_reviewer) {
    req.session.isReviewer = true;
    req.session.userRoles.push('reviewer');
  }
  
  if (req.session.userRoles.length === 0) {
    req.session.isPublic = true;
  }
  
  // Primeiro acesso: forçar mudança de senha
  if (!user.password_changed) {
    if (req.session.isAdmin || req.session.isReviewer) {
      return res.redirect('/login/change-password');
    }
    return res.redirect('/login/change-password');
  }
  
  // Redirecionar baseado no perfil
  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  
  if (req.session.isReviewer) {
    return res.redirect('/reviewer');
  }
  
  return res.redirect('/');
});

// Logout (GET e POST)
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    req.session = null;
    res.clearCookie('connect.sid');
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Accel-Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.redirect('/login');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    req.session = null;
    res.clearCookie('connect.sid');
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Accel-Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.redirect('/login');
  });
});

// Trocar senha (primeiro acesso) - unificado
router.get('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.prepare('SELECT password_changed FROM users WHERE id = ?').bind(req.session.userId).get();
  if (user && user.password_changed) {
    if (req.session.isAdmin) return res.redirect('/admin/dashboard');
    if (req.session.isReviewer) return res.redirect('/reviewer');
    return res.redirect('/');
  }
  res.render('change-password', { 
    title: 'Trocar Senha', 
    action: 'change-password',
    success: null,
    error: null,
    year: new Date().getFullYear()
  });
});

router.post('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { new_password, confirm_password } = req.body;
  
  if (!new_password || !confirm_password) {
    return res.render('change-password', { 
      title: 'Trocar Senha', 
      action: 'change-password',
      error: 'Todos os campos são obrigatórios.',
      year: new Date().getFullYear()
    });
  }
  
  if (new_password !== confirm_password) {
    return res.render('change-password', { 
      title: 'Trocar Senha', 
      action: 'change-password',
      error: 'As senhas não conferem.',
      year: new Date().getFullYear()
    });
  }
  
  if (new_password.length < 6) {
    return res.render('change-password', { 
      title: 'Trocar Senha', 
      action: 'change-password',
      error: 'A senha deve ter pelo menos 6 caracteres.',
      year: new Date().getFullYear()
    });
  }
  
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ?, password_changed = 1 WHERE id = ?').bind(hash, req.session.userId).run();
  
  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  if (req.session.isReviewer) {
    return res.redirect('/reviewer');
  }
  return res.redirect('/');
});

module.exports = { router, requireAuth };
