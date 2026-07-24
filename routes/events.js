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

// Criar evento
router.post('/', (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status } = req.body;
  db.prepare(`
    INSERT INTO events (name, short_name, description, date_start, date_end, location, url, area, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', area, status || 'draft');
  res.redirect('/admin/events');
});

// Editar evento
router.get('/:id/edit', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const areas = db.prepare('SELECT DISTINCT area FROM events').all().map(e => e.area);
  res.render('admin/events/form', { event, areas, title: 'Editar Evento' });
});

// Atualizar evento
router.put('/:id', (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status } = req.body;
  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', area, status, req.params.id);
  res.redirect('/admin/events');
});

// Deletar evento
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.redirect('/admin/events');
});

// Stats do evento
router.get('/:id/stats', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const totalArticles = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ?').get(req.params.id).cnt;
  const approved = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status = ?').get(req.params.id, 'approved').cnt;
  const rejected = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status = ?').get(req.params.id, 'rejected').cnt;
  const pending = totalArticles - approved - rejected;
  const reviewers = db.prepare('SELECT COUNT(DISTINCT reviewer_id) as cnt FROM assignments WHERE event_id = ?').get(req.params.id).cnt;
  const assigned = db.prepare('SELECT COUNT(DISTINCT article_id) as cnt FROM assignments WHERE event_id = ?').get(req.params.id).cnt;

  const articles = db.prepare('SELECT * FROM articles WHERE event_id = ? ORDER BY created_at DESC').all(req.params.id);
  const topReviewers = db.prepare(`
    SELECT reviewer_id, reviewer_name, COUNT(*) as cnt
    FROM assignments WHERE event_id = ?
    GROUP BY reviewer_id ORDER BY cnt DESC LIMIT 5
  `).all(req.params.id);

  res.render('admin/events/stats', {
    event, title: 'Stats - ' + event.name,
    totalArticles, approved, rejected, pending, reviewers, assigned,
    articles, topReviewers
  });
});

// Publicar evento
router.post('/:id/publish', (req, res) => {
  db.prepare('UPDATE events SET status = ?, updated_at = datetime("now") WHERE id = ?').run('published', req.params.id);
  res.redirect('/admin/events');
});

module.exports = router;