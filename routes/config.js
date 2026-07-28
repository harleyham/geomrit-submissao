const express = require('express');
const router = express.Router();
const { db } = require('../db');
const bcrypt = require('bcryptjs');

// Middleware de autenticação admin
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Página de configuração
router.get('/', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, is_admin, is_reviewer, is_public, password_changed, created_at FROM users ORDER BY name').all();
  const adminUsers = users.filter(u => u.is_admin);
  const reviewerUsers = users.filter(u => u.is_reviewer);
  
  res.render('admin/config', { 
    title: 'Configurações', 
    users,
    adminUsers,
    reviewerUsers,
    year: new Date().getFullYear(),
    success: req.query.success,
    error: req.query.error
  });
});

// Alterar senha do admin (atual)
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  
  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/admin/users?error=Todos os campos são obrigatórios');
  }
  
  if (new_password !== confirm_password) {
    return res.redirect('/admin/users?error=As senhas não conferem');
  }
  
  if (new_password.length < 6) {
    return res.redirect('/admin/users?error=A senha deve ter pelo menos 6 caracteres');
  }
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(req.session.userId).get();
  
  if (!user) {
    return res.redirect('/admin/users?error=Erro ao buscar usuário');
  }
  
  const valid = bcrypt.compareSync(current_password, user.password);
  if (!valid) {
    return res.redirect('/admin/users?error=Senha atual incorreta');
  }
  
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hash, req.session.userId).run();
  
  res.redirect('/admin/users?success=Senha alterada com sucesso');
});

// Resetar senha de usuário para padrão
router.post('/reset-password', requireAuth, (req, res) => {
  const { user_id, new_password, default_reset } = req.body;
  
  if (!user_id) {
    return res.redirect('/admin/users?error=Selecione um usuário');
  }
  
  let password;
  if (default_reset === 'true') {
    password = '123456';
  } else if (new_password) {
    if (new_password.length < 6) {
      return res.redirect('/admin/users?error=A senha deve ter pelo menos 6 caracteres');
    }
    password = new_password;
  } else {
    return res.redirect('/admin/users?error=Informe a nova senha');
  }
  
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ?, password_changed = 0 WHERE id = ?').bind(hash, user_id).run();
  
  if (default_reset === 'true') {
    res.redirect('/admin/users?success=Senha resetada para 123456 (usuário deve alterar no próximo login)');
  } else {
    res.redirect('/admin/users?success=Senha do usuário alterada (usuário deve alterar no próximo login)');
  }
});

// Toggle is_admin
router.post('/toggle-admin', requireAuth, (req, res) => {
  const { user_id, is_admin } = req.body;
  if (!user_id) return res.redirect('/admin/users?error=Usuário não selecionado');
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(is_admin === '1' || is_admin === 1 ? 1 : 0, user_id).run();
  res.redirect('/admin/users');
});

// Toggle is_reviewer
router.post('/toggle-reviewer', requireAuth, (req, res) => {
  const { user_id, is_reviewer } = req.body;
  if (!user_id) return res.redirect('/admin/users?error=Usuário não selecionado');
  db.prepare('UPDATE users SET is_reviewer = ? WHERE id = ?').bind(is_reviewer === '1' || is_reviewer === 1 ? 1 : 0, user_id).run();
  res.redirect('/admin/users');
});

// Toggle is_public
router.post('/toggle-public', requireAuth, (req, res) => {
  const { user_id, is_public } = req.body;
  if (!user_id) return res.redirect('/admin/users?error=Usuário não selecionado');
  db.prepare('UPDATE users SET is_public = ? WHERE id = ?').bind(is_public === '1' || is_public === 1 ? 1 : 0, user_id).run();
  res.redirect('/admin/users');
});

module.exports = router;
