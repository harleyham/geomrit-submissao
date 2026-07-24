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

// Login admin
router.get('/', (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.render('login', {
    error: null,
    year: new Date().getFullYear()
  });
});

// Dashboard admin
router.get('/dashboard', (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  
  const totalEvents = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
  const publishedEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'published'").get().count;
  const totalArticles = db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
  const totalReviewers = db.prepare("SELECT COUNT(*) as count FROM reviewers WHERE is_active = 1").get().count;
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
    totalReviewers,
    recentArticles,
    year: new Date().getFullYear()
  });
});

router.post('/', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  
  if (admin) {
    const bcrypt = require('bcryptjs');
    const valid = bcrypt.compareSync(password, admin.password);
    if (valid) {
      req.session.isAdmin = true;
      req.session.adminUsername = admin.username;
      return res.redirect('/admin/dashboard');
    }
  }
  
  res.render('login', {
    error: 'Credenciais inválidas.',
    year: new Date().getFullYear()
  });
});

// Logout (GET e POST)
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    req.session = null;
    res.clearCookie('connect.sid');
    res.clearCookie('connect.sid', { path: '/admin' });
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Accel-Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.redirect('/admin/login');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    req.session = null;
    res.clearCookie('connect.sid');
    res.clearCookie('connect.sid', { path: '/admin' });
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Accel-Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.redirect('/admin/login');
  });
});

module.exports = { router, requireAuth };