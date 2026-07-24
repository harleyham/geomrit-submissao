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
  const areaFilter = req.query.area || '';
  let sql = 'SELECT * FROM reviewers WHERE is_active = 1';
  const params = [];
  if (areaFilter) {
    sql += ' AND area = ?';
    params.push(areaFilter);
  }
  sql += ' ORDER BY area, name';
  const reviewers = db.prepare(sql).all(...params);
  const allAreas = db.prepare('SELECT DISTINCT area FROM reviewers WHERE is_active=1 ORDER BY area').all().map(r => r.area);
  res.render('admin/reviewers/list', { reviewers, allAreas, areaFilter, title: 'Revisores' });
});

router.get('/new', requireAuth, (req, res) => {
  const areas = db.prepare('SELECT DISTINCT area FROM reviewers ORDER BY area').all().map(r => r.area);
  res.render('admin/reviewers/form', { reviewer: null, areas, title: 'Novo Revisor' });
});

router.post('/', requireAuth, (req, res) => {
  const { name, email, area, institution, bio, is_active, password } = req.body;
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  db.prepare(`
    INSERT INTO reviewers (name, email, password, area, institution, bio, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(name, email, hash, area, institution || '', bio || '', is_active === 'on' ? 1 : 0);
  res.redirect('/admin/reviewers');
});

router.get('/:id/edit', requireAuth, (req, res) => {
  const reviewer = db.prepare('SELECT * FROM reviewers WHERE id = ?').get(req.params.id);
  if (!reviewer) return res.status(404).render('error', { title: 'Revisor não encontrado' });
  const areas = db.prepare('SELECT DISTINCT area FROM reviewers ORDER BY area').all().map(r => r.area);
  res.render('admin/reviewers/form', { reviewer, areas, title: 'Editar Revisor' });
});

router.put('/:id', requireAuth, (req, res) => {
  const { name, email, area, institution, bio, is_active, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      UPDATE reviewers SET name=?, email=?, area=?, institution=?, bio=?, is_active=?, password=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, email, area, institution || '', bio || '', is_active === 'on' ? 1 : 0, hash, req.params.id);
  } else {
    db.prepare(`
      UPDATE reviewers SET name=?, email=?, area=?, institution=?, bio=?, is_active=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, email, area, institution || '', bio || '', is_active === 'on' ? 1 : 0, req.params.id);
  }
  res.redirect('/admin/reviewers');
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM reviewers WHERE id = ?').run(req.params.id);
  res.redirect('/admin/reviewers');
});

module.exports = router;