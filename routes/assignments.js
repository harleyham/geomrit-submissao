const express = require('express');
const router = express.Router();
const { db, getUnassignedArticles, getAssignmentsByEvent } = require('../db');

router.get('/', (req, res) => {
  const eventId = parseInt(req.query.eventId);
  if (!eventId) return res.redirect('/admin');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const unassigned = getUnassignedArticles(eventId);
  const assignments = getAssignmentsByEvent(eventId);
  const reviewers = db.prepare('SELECT * FROM reviewers WHERE is_active = 1 ORDER BY area, name').all();
  res.render('admin/assignments/list', { event, unassigned, assignments, reviewers, title: 'Distribuição - ' + event.name });
});

router.post('/bulk', (req, res) => {
  const { event_id, article_ids, reviewer_ids } = req.body;
  if (!article_ids || !reviewer_ids) {
    return res.status(400).json({ error: 'Selecione artigos e revisores' });
  }
  const articles = Array.isArray(article_ids) ? article_ids : [article_ids];
  const reviewers = Array.isArray(reviewer_ids) ? reviewer_ids : [reviewer_ids];
  
  articles.forEach(articleId => {
    reviewers.forEach(reviewerId => {
      db.prepare('INSERT OR IGNORE INTO assignments (article_id, reviewer_id, status) VALUES (?, ?, "accepted")').run(articleId, reviewerId);
      db.prepare('UPDATE articles SET status = "in_review" WHERE id = ?').run(articleId);
    });
  });
  res.redirect(`/admin/assignments?eventId=${event_id}`);
});

router.post('/:id/assign', (req, res) => {
  const { reviewer_id } = req.body;
  if (reviewer_id) {
    db.prepare('INSERT OR IGNORE INTO assignments (article_id, reviewer_id, status) VALUES (?, ?, "accepted")').run(req.params.id, reviewer_id);
    db.prepare('UPDATE articles SET status = "in_review" WHERE id = ?').run(req.params.id);
  }
  res.redirect(`/admin/assignments?eventId=${req.query.eventId}`);
});

router.post('/:id/unassign', (req, res) => {
  const { reviewer_id, eventId } = req.body;
  db.prepare('DELETE FROM assignments WHERE article_id = ? AND reviewer_id = ?').run(req.params.id, reviewer_id);
  const count = db.prepare('SELECT COUNT(*) as count FROM assignments WHERE article_id = ?').get(req.params.id).count;
  if (count === 0) {
    db.prepare('UPDATE articles SET status = "submitted" WHERE id = ?').run(req.params.id);
  }
  res.redirect(`/admin/assignments?eventId=${eventId || req.query.eventId}`);
});

module.exports = router;