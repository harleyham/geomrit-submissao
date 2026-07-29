const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { db, getArticlesByEvent } = require('../db');

function parseAreaList(areaValue) {
  return String(areaValue || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeArea(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

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
  const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const articles = getArticlesByEvent(eventId);
  res.render('admin/articles/list', { event, articles, title: 'Artigos - ' + event.name });
});

// Detalhe do artigo
router.get('/:id', requireAuth, (req, res) => {
  const article = db.prepare(`
    SELECT a.*, e.name as event_name, e.area as event_area,
      GROUP_CONCAT(DISTINCT u.name) as assigned_reviewers
    FROM articles a
    JOIN events e ON e.id = a.event_id
    LEFT JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN users u ON u.id = ass.reviewer_id
    WHERE a.id = ?
    GROUP BY a.id
  `).bind(req.params.id).get();
  if (!article) return res.status(404).render('error', { title: 'Artigo não encontrado' });
  const assignedReviewers = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.institution,
      ass.status as assignment_status
    FROM assignments ass
    JOIN users u ON u.id = ass.reviewer_id
    WHERE ass.article_id = ?
    ORDER BY u.name COLLATE NOCASE
  `).bind(req.params.id).all();

  const assignedReviewerIds = new Set(assignedReviewers.map((reviewer) => reviewer.id));
  const articleArea = normalizeArea(article.area);
  const availableReviewers = db.prepare(`
    SELECT id, name, email, institution, reviewer_areas
    FROM users
    WHERE is_reviewer = 1
      AND is_public = 1
    ORDER BY name COLLATE NOCASE
  `).all().map((reviewer) => {
    const reviewerAreaList = parseAreaList(reviewer.reviewer_areas);
    const normalizedReviewerAreas = reviewerAreaList.map(normalizeArea);
    const matchesArticleArea = !!articleArea && normalizedReviewerAreas.includes(articleArea);

    return {
      ...reviewer,
      reviewer_area_list: reviewerAreaList,
      is_assigned: assignedReviewerIds.has(reviewer.id),
      matches_article_area: matchesArticleArea
    };
  }).sort((left, right) => {
    if (left.is_assigned !== right.is_assigned) return left.is_assigned ? 1 : -1;
    if (left.matches_article_area !== right.matches_article_area) return left.matches_article_area ? -1 : 1;
    return left.name.localeCompare(right.name, 'pt-BR');
  });

  res.render('admin/articles/detail', {
    article,
    assignedReviewers,
    availableReviewers,
    title: article.title
  });
});

// Atualizar status
router.put('/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now") WHERE id = ?').bind(status, req.params.id).run();
  res.json({ success: true });
});

// Download do arquivo
router.get('/:id/download', requireAuth, (req, res) => {
  const article = db.prepare('SELECT pdf_path, file_original_name FROM articles WHERE id = ?').bind(req.params.id).get();
  if (!article || !article.pdf_path) return res.status(404).render('error', { title: 'Arquivo não encontrado' });
  const filePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
  res.download(filePath, article.file_original_name || 'artigo.pdf');
});

// Deletar artigo
router.delete('/:id', requireAuth, (req, res) => {
  const article = db.prepare('SELECT pdf_path FROM articles WHERE id = ?').bind(req.params.id).get();
  if (article && article.pdf_path) {
    const filePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  db.prepare('DELETE FROM articles WHERE id = ?').bind(req.params.id).run();
  res.redirect('/admin/articles?eventId=' + req.query.eventId);
});

// Atribuir revisor a artigo
router.post('/:id/assign', requireAuth, (req, res) => {
  const { reviewer_id, action, eventId } = req.body;
  if (action === 'assign') {
    const existing = db.prepare('SELECT id FROM assignments WHERE article_id = ? AND reviewer_id = ?').bind(req.params.id, reviewer_id).get();
    if (existing) return res.redirect('/admin/articles/' + req.params.id);
    db.prepare("INSERT OR IGNORE INTO assignments (article_id, reviewer_id, status) VALUES (?, ?, 'pending')").bind(req.params.id, reviewer_id).run();
    db.prepare("UPDATE articles SET status = 'in_review', updated_at = datetime('now') WHERE id = ?").bind(req.params.id).run();
  } else if (action === 'unassign') {
    db.prepare('DELETE FROM assignments WHERE article_id = ? AND reviewer_id = ?').bind(req.params.id, reviewer_id).run();
    const assignedCount = db.prepare('SELECT COUNT(*) as count FROM assignments WHERE article_id = ?').bind(req.params.id).get().count;
    if (assignedCount === 0) {
      db.prepare("UPDATE articles SET status = 'pending', updated_at = datetime('now') WHERE id = ?").bind(req.params.id).run();
    }
  }
  res.redirect('/admin/articles/' + req.params.id);
});

module.exports = router;
