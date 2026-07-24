const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { db, getArticlesByEvent } = require('../db');

// Middleware de autenticação admin
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Listar artigos de um evento
router.get('/', requireAuth, (req, res) => {
  const eventId = parseInt(req.query.eventId);
  if (!eventId) return res.redirect('/admin');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const articles = getArticlesByEvent(eventId);
  res.render('admin/articles/list', { event, articles, title: 'Artigos - ' + event.name });
});

// Detalhe do artigo
router.get('/:id', requireAuth, (req, res) => {
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
router.put('/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now") WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// Download do arquivo
router.get('/:id/download', requireAuth, (req, res) => {
  const article = db.prepare('SELECT pdf_path, file_original_name FROM articles WHERE id = ?').get(req.params.id);
  if (!article || !article.pdf_path) return res.status(404).render('error', { title: 'Arquivo não encontrado' });
  const filePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
  res.download(filePath, article.file_original_name || 'artigo.pdf');
});

// Deletar artigo
router.delete('/:id', requireAuth, (req, res) => {
  const article = db.prepare('SELECT pdf_path FROM articles WHERE id = ?').get(req.params.id);
  if (article && article.pdf_path) {
    const filePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.redirect('/admin/articles?eventId=' + req.query.eventId);
});

// Atribuir revisor a artigo
router.post('/:id/assign', requireAuth, (req, res) => {
  const { reviewer_id, action, eventId } = req.body;
  if (action === 'assign') {
    const existing = db.prepare('SELECT id FROM assignments WHERE article_id = ? AND reviewer_id = ?').get(req.params.id, reviewer_id);
    if (existing) return res.redirect('/admin/articles/' + req.params.id);
    db.prepare('INSERT OR IGNORE INTO assignments (article_id, reviewer_id, status) VALUES (?, ?, "pending")').run(req.params.id, reviewer_id);
    db.prepare('UPDATE articles SET status = "in_review", updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  } else if (action === 'unassign') {
    db.prepare('DELETE FROM assignments WHERE article_id = ? AND reviewer_id = ?').run(req.params.id, reviewer_id);
    const assignedCount = db.prepare('SELECT COUNT(*) as count FROM assignments WHERE article_id = ?').get(req.params.id).count;
    if (assignedCount === 0) {
      db.prepare('UPDATE articles SET status = "pending", updated_at = datetime("now") WHERE id = ?').run(req.params.id);
    }
  }
  res.redirect('/admin/articles/' + req.params.id);
});

module.exports = router;
