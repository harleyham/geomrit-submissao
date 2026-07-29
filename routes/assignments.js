const express = require('express');
const router = express.Router();
const { db, getUnassignedArticles, getAssignmentsByEvent, getStatsByEvent } = require('../db');

// Middleware de autenticação admin para atribuições
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Atribuir revisor a artigo
router.post('/:articleId', requireAuth, (req, res) => {
  const { eventId, reviewerId } = req.body;
  if (!reviewerId) {
    return res.status(400).json({ error: 'Revisor não selecionado' });
  }
  
  // Verificar se o revisor já foi atribuído a este artigo
  const existing = db.prepare('SELECT id FROM assignments WHERE article_id = ? AND reviewer_id = ?').bind(req.params.articleId, reviewerId).get();
  if (existing) {
    return res.status(400).json({ error: 'Revisor já atribuído' });
  }
  
  db.prepare(`
    INSERT INTO assignments (article_id, reviewer_id, status, created_at, updated_at)
    VALUES (?, ?, 'pending', datetime('now'), datetime('now'))
  `).bind(req.params.articleId, reviewerId).run();
  
  db.prepare(`
    UPDATE articles SET status = 'in_review', updated_at = datetime('now') WHERE id = ?
  `).bind(req.params.articleId).run();
  
  const redirectUrl = eventId ? `/admin/assignments?eventId=${eventId}` : '/admin/assignments';
  res.redirect(redirectUrl);
});

// Aceitar atribuição
router.post('/accept/:id', requireAuth, (req, res) => {
  db.prepare(`
    UPDATE assignments 
    SET status = 'accepted', updated_at = datetime('now') 
    WHERE id = ?
  `).bind(req.params.id).run();
  
  db.prepare(`
    UPDATE articles SET status = 'in_review', updated_at = datetime('now') 
    WHERE id = (SELECT article_id FROM assignments WHERE id = ?)
  `).bind(req.params.id).run();
  
  res.redirect(`/admin/assignments?eventId=${req.body.eventId}`);
});

// Recusar atribuição
router.post('/decline/:id', requireAuth, (req, res) => {
  db.prepare(`
    UPDATE assignments 
    SET status = 'declined', updated_at = datetime('now') 
    WHERE id = ?
  `).bind(req.params.id).run();
  
  res.redirect(`/admin/assignments?eventId=${req.body.eventId}`);
});

module.exports = router;
