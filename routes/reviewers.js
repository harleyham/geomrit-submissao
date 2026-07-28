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

router.get('/', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, is_reviewer, is_admin, is_public, password_changed, created_at FROM users WHERE is_reviewer = 1 ORDER BY name').all();
  res.render('admin/reviewers/list', { reviewers: users, allAreas: [], title: 'Revisores' });
});

router.get('/new', requireAuth, (req, res) => {
  res.render('admin/reviewers/form', { reviewer: null, areas: ['Outra'], title: 'Novo Revisor', year: new Date().getFullYear() });
});

router.post('/', requireAuth, (req, res) => {
  const { name, email, area, password } = req.body;
  if (!name || !email || !password) {
    return res.render('admin/reviewers/form', {
      reviewer: { name, email, area },
      areas: ['Outra'],
      title: 'Novo Revisor',
      year: new Date().getFullYear(),
      error: 'Nome, e-mail e senha são obrigatórios.'
    });
  }
  
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(email).get();
  if (existing) {
    return res.render('admin/reviewers/form', {
      reviewer: { name, email, area },
      areas: ['Outra'],
      title: 'Novo Revisor',
      year: new Date().getFullYear(),
      error: 'Já existe um usuário com o e-mail ' + email
    });
  }
  
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, password, is_reviewer, is_admin, is_public, password_changed, created_at, updated_at)
    VALUES (?, ?, ?, 1, 0, 1, 0, datetime('now'), datetime('now'))
  `).bind(name, email, hash).run();
  
  res.redirect('/admin/reviewers');
});

router.post('/:id', requireAuth, (req, res) => {
  const { _method, name, email, password, is_active } = req.body;
  const id = parseInt(req.params.id, 10);

  if (_method === 'DELETE') {
    db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return res.redirect('/admin/reviewers');
  }

  if (_method === 'PUT') {
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET name=?, email=?, password=?, is_reviewer=1, is_admin=0, is_public=?, password_changed=0, updated_at=datetime(\'now\') WHERE id=?')
        .bind(name, email, hash, is_active === 'on' ? 1 : 0, id).run();
    } else {
      db.prepare('UPDATE users SET name=?, email=?, is_reviewer=1, is_admin=0, is_public=?, updated_at=datetime(\'now\') WHERE id=?')
        .bind(name, email, is_active === 'on' ? 1 : 0, id).run();
    }
    return res.redirect('/admin/reviewers');
  }

  // Fallback: edit
  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(id).get();
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, password=?, is_reviewer=1, is_admin=0, is_public=?, password_changed=0, updated_at=datetime(\'now\') WHERE id=?')
      .bind(name, email, hash, is_active === 'on' ? 1 : 0, id).run();
  } else {
    db.prepare('UPDATE users SET name=?, email=?, is_reviewer=1, is_admin=0, is_public=?, updated_at=datetime(\'now\') WHERE id=?')
      .bind(name, email, is_active === 'on' ? 1 : 0, id).run();
  }
  res.redirect('/admin/reviewers');
});

router.get('/:id/edit', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(req.params.id).get();
  if (!user) return res.status(404).render('error', { title: 'Usuário não encontrado' });
  res.render('admin/reviewers/form', { reviewer: user, areas: ['Outra'], title: 'Editar Revisor', year: new Date().getFullYear() });
});

router.put('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, password, is_active } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, password=?, is_reviewer=1, is_admin=0, is_public=?, password_changed=0, updated_at=datetime(\'now\') WHERE id=?')
      .bind(name, email, hash, is_active === 'on' ? 1 : 0, id).run();
  } else {
    db.prepare('UPDATE users SET name=?, email=?, is_reviewer=1, is_admin=0, is_public=?, updated_at=datetime(\'now\') WHERE id=?')
      .bind(name, email, is_active === 'on' ? 1 : 0, id).run();
  }
  res.redirect('/admin/reviewers');
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').bind(req.params.id).run();
  res.redirect('/admin/reviewers');
});

module.exports = router;
