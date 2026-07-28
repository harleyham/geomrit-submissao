const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Listar eventos
router.get('/', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY date_start DESC').all();
  res.render('admin/events/list', { events, title: 'Eventos' });
});

// Novo evento
router.get('/new', (req, res) => {
  const areas = db.prepare('SELECT DISTINCT area FROM events').all().map(e => e.area);
  res.render('admin/events/form', { event: null, areas, title: 'Novo Evento' });
});

// POST /:id — handles form submissions with _method override (edit & delete)
router.post('/:id', (req, res) => {
  const { _method, name, short_name, description, date_start, date_end, location, url, area, status, institution, language, submission_start, submission_end } = req.body;

  // Handle PUT (edit event)
  if (_method === 'PUT') {
    const id = req.params.id;
    db.prepare(`
      UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, status=?, institution=?, language=?, submission_start=?, submission_end=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', area, status || 'draft', institution || '', language || '', submission_start || null, submission_end || null, id).run();
    return res.redirect('/admin/events');
  }

  // Handle DELETE
  if (_method === 'DELETE') {
    db.prepare('DELETE FROM events WHERE id = ?').bind(req.params.id).run();
    return res.redirect('/admin/events');
  }

  // Fallback: treat as update (edit)
  const id = req.params.id;
  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, status=?, institution=?, language=?, submission_start=?, submission_end=?, updated_at=datetime('now')
    WHERE id=?
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', area, status || 'draft', institution || '', language || '', submission_start || null, submission_end || null, id).run();
  res.redirect('/admin/events');
});

// Criar evento
router.post('/', (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, submission_start, submission_end } = req.body;
  db.prepare(`
    INSERT INTO events (name, short_name, description, date_start, date_end, location, url, area, status, submission_start, submission_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', area, status || 'draft', submission_start || null, submission_end || null).run();
  res.redirect('/admin/events');
});

// Editar evento
router.get('/:id/edit', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const areas = db.prepare('SELECT DISTINCT area FROM events').all().map(e => e.area);
  res.render('admin/events/form', { event, areas, title: 'Editar Evento' });
});

// Atualizar evento (via PUT from method-override or fetch API)
router.put('/:id', (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, submission_start, submission_end } = req.body;
  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, status=?, submission_start=?, submission_end=?, updated_at=datetime('now')
    WHERE id=?
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', area, status, submission_start || null, submission_end || null, req.params.id).run();
  res.redirect('/admin/events');
});

// Deletar evento
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').bind(req.params.id).run();
  res.redirect('/admin/events');
});

// Stats do evento
router.get('/:id/stats', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const totalArticles = db.prepare("SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status != 'draft'").bind(req.params.id).get().cnt;
  const approved = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status = ?').bind(req.params.id, 'approved').get().cnt;
  const rejected = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status = ?').bind(req.params.id, 'rejected').get().cnt;
  const pending = totalArticles - approved - rejected;

  const articleIds = db.prepare("SELECT id FROM articles WHERE event_id = ? AND status != 'draft'").bind(req.params.id).all().map(a => a.id);
  let reviewersCount = 0;
  let assignedCount = 0;
  const topReviewers = [];
  if (articleIds.length > 0) {
    const ids = articleIds.map(() => '?').join(',');
    reviewersCount = db.prepare(`SELECT COUNT(DISTINCT reviewer_id) as cnt FROM assignments WHERE article_id IN (${ids})`).bind(...articleIds).all()[0].cnt;
    assignedCount = db.prepare(`SELECT COUNT(DISTINCT article_id) as cnt FROM assignments WHERE article_id IN (${ids})`).bind(...articleIds).all()[0].cnt;
    topReviewers = db.prepare(`
      SELECT u.id as reviewer_id, u.name as reviewer_name, COUNT(*) as cnt
      FROM assignments a
      JOIN users u ON u.id = a.reviewer_id
      WHERE a.article_id IN (${ids})
      GROUP BY u.id ORDER BY cnt DESC LIMIT 5
    `).bind(...articleIds).all();
  }

  const articles = db.prepare("SELECT * FROM articles WHERE event_id = ? AND status != 'draft' ORDER BY created_at DESC").bind(req.params.id).all();

  res.render('admin/events/stats', {
    event, title: 'Stats - ' + event.name, year: new Date().getFullYear(),
    totalArticles, approved, rejected, pending, reviewers: reviewersCount, assigned: assignedCount,
    articles, topReviewers
  });
});

// Publicar evento
router.post('/:id/publish', (req, res) => {
  db.prepare("UPDATE events SET status = ?, updated_at = datetime('now') WHERE id = ?").bind('published', req.params.id).run();
  res.redirect('/admin/events');
});

module.exports = router;
