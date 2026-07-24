const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { db, getArticlesByEvent } = require('../db');

// Listar artigos de um evento
router.get('/', (req, res) => {
  const eventId = parseInt(req.query.eventId);
  if (!eventId) return res.redirect('/admin');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const articles = getArticlesByEvent(eventId);
  res.render('admin/articles/list', { event, articles, title: 'Artigos - ' + event.name });
});

// Detalle do artigo
router.get('/:id', (req, res) => {
  const article = db.prepare(`
    SELECT a.*, e.name as event_name, e.area,
      GROUP_CONCAT(DISTINCT r.name) as assigned_reviewers
    FROM articles a
    JOIN events e ON e.id = a.event_id
    LEFT JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN reviewers r ON r.id = ass.reviewer_id
    WHERE a.id = ?
    GROUP BY a.id
  `).get(req.params.id);
  if (!article) return res.status(404).render('error', { title: 'Artigo não encontrado' });
  res.render('admin/articles/detail', { article, title: article.title });
});

// Atualizar status
router.put('/:id', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now") WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// Download do arquivo
router.get('/:id/download', (req, res) => {
  const article = db.prepare('SELECT file_path, file_original_name FROM articles WHERE id = ?').get(req.params.id);
  if (!article || !article.file_path) return res.status(404).render('error', { title: 'Arquivo não encontrado' });
  const filePath = path.join(__dirname, '..', 'uploads', article.file_path);
  res.download(filePath, article.file_original_name || 'artigo.pdf');
});

// Deletar artigo
router.delete('/:id', (req, res) => {
  const article = db.prepare('SELECT file_path FROM articles WHERE id = ?').get(req.params.id);
  if (article && article.file_path) {
    const filePath = path.join(__dirname, '..', 'uploads', article.file_path);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.redirect('/admin/articles?eventId=' + req.query.eventId);
});

// Atribuir revisor a artigo
router.post('/:id/assign', (req, res) => {
  const { reviewer_id, action } = req.body;
  if (action === 'assign') {
    db.prepare('INSERT OR IGNORE INTO assignments (article_id, reviewer_id, status) VALUES (?, ?, "accepted")').run(req.params.id, reviewer_id);
    db.prepare('UPDATE articles SET status = "in_review" WHERE id = ?').run(req.params.id);
  } else if (action === 'unassign') {
    db.prepare('DELETE FROM assignments WHERE article_id = ? AND reviewer_id = ?').run(req.params.id, reviewer_id);
    const assignedCount = db.prepare('SELECT COUNT(*) as count FROM assignments WHERE article_id = ?').get(req.params.id).count;
    if (assignedCount === 0) {
      db.prepare('UPDATE articles SET status = "submitted" WHERE id = ?').run(req.params.id);
    }
  }
  res.redirect('/admin/articles/' + req.params.id);
});

module.exports = router;