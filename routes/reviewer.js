const express = require('express');
const { db } = require('../db');
const { strictLimiter } = require('../security/rate-limits');
const { validators: v, validateAndHandle } = require('../security/validation');

const router = express.Router();

function getReviewerDashboardData(reviewerId, reviewerName) {
  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT ass.id) as total,
      COALESCE(SUM(CASE WHEN rp.id IS NULL AND ass.status != 'declined' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN rp.recommendation = 'approved' THEN 1 ELSE 0 END), 0) as approved,
      COALESCE(SUM(CASE WHEN rp.recommendation = 'rejected' THEN 1 ELSE 0 END), 0) as rejected
    FROM assignments ass
    JOIN articles a ON a.id = ass.article_id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE ass.reviewer_id = ?
  `).bind(reviewerId).get();

  const pendingArticles = db.prepare(`
    SELECT
      a.id, a.title, a.contributor, a.date_submitted, a.area, a.type,
      e.name as event_name,
      ass.id as assignment_id,
      ass.status as assignment_status
    FROM assignments ass
    JOIN articles a ON a.id = ass.article_id
    JOIN events e ON e.id = a.event_id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE ass.reviewer_id = ?
      AND ass.status != 'declined'
      AND rp.id IS NULL
    ORDER BY a.date_submitted DESC, ass.created_at DESC
    LIMIT 50
  `).bind(reviewerId).all();

  const reviewedArticles = db.prepare(`
    SELECT
      a.id, a.title, a.date_submitted, a.area, a.type,
      e.name as event_name,
      rp.recommendation,
      rp.updated_at as reviewed_at
    FROM assignments ass
    JOIN articles a ON a.id = ass.article_id
    JOIN events e ON e.id = a.event_id
    JOIN reports rp ON rp.assignment_id = ass.id
    WHERE ass.reviewer_id = ?
    ORDER BY COALESCE(rp.updated_at, rp.created_at) DESC, a.date_submitted DESC
    LIMIT 50
  `).bind(reviewerId).all();

  return {
    reviewer: { name: reviewerName, area: '' },
    stats: {
      total: stats.total || 0,
      pending: stats.pending || 0,
      approved: stats.approved || 0,
      rejected: stats.rejected || 0
    },
    pendingArticles,
    reviewedArticles,
    year: new Date().getFullYear()
  };
}

// Middleware de autenticação revisor: o papel vem do banco (event_user_roles),
// não mais de flag global ou de sessão.
function requireReviewer(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId || !db.prepare("SELECT 1 FROM event_user_roles WHERE user_id = ? AND role = 'reviewer' LIMIT 1").get(userId)) {
    return res.redirect('/login');
  }
  next();
}

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    req.session = null;
    res.clearCookie('connect.sid');
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Accel-Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.redirect('/');
  });
});

// Dashboard do revisor
router.get('/', requireReviewer, (req, res) => {
  const reviewerId = req.session.userId;
  res.render('reviewer/dashboard', getReviewerDashboardData(reviewerId, req.session.userName));
});

// Ver artigo para revisão
router.get('/articles/:id', requireReviewer, (req, res) => {
  const articleId = req.params.id;
  const reviewerId = req.session.userId;
  
  const assignment = db.prepare(`
    SELECT * FROM assignments 
    WHERE article_id = ? AND reviewer_id = ?
  `).bind(articleId, reviewerId).get();
  
  if (!assignment) {
    return res.render('reviewer/dashboard', {
      ...getReviewerDashboardData(reviewerId, req.session.userName),
      error: 'Artigo não pertence à sua lista de revisão.'
    });
  }
  
  const article = db.prepare(`
    SELECT a.*, e.name as event_name, e.date_start as event_date_start
    FROM articles a
    LEFT JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `).bind(articleId).get();
  
  if (!article) {
    return res.render('reviewer/dashboard', {
      ...getReviewerDashboardData(reviewerId, req.session.userName),
      error: 'Artigo não encontrado.'
    });
  }
  
  res.render('reviewer/article', {
    article,
    reviewer: { name: req.session.userName, area: '' },
    year: new Date().getFullYear()
  });
});

// Submeter revisão
router.post('/articles/:id/review', requireReviewer, strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.reviewerForm);
}, (req, res) => {
  const articleId = req.params.id;
  const { recommendation, review_notes, rejection_reason } = req.body;
  const reviewerId = req.session.userId;
  
  const assignment = db.prepare(`
    SELECT * FROM assignments 
    WHERE article_id = ? AND reviewer_id = ?
  `).bind(articleId, reviewerId).get();
  
  if (!assignment) {
    return res.redirect('/reviewer');
  }
  
  const normalizedRecommendation = recommendation === 'rejected'
    ? 'rejected'
    : recommendation === 'revision_requested'
      ? 'revision_requested'
      : 'approved';
  const reportBody = normalizedRecommendation === 'rejected' && rejection_reason
    ? `${review_notes}\n\nMotivo da rejeicao: ${rejection_reason}`
    : review_notes;

  const article = db.prepare('SELECT status FROM articles WHERE id = ?').bind(articleId).get();
  const nextArticleStatus = ['approved', 'rejected'].includes(article && article.status)
    ? article.status
    : 'in_review';

  db.prepare(`
    UPDATE articles
    SET status = ?, updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `).bind(
    nextArticleStatus,
    articleId
  ).run();
  
  db.prepare(`
    UPDATE assignments SET reviewed_at = datetime('now', '-3 hours'), status = 'reviewed', updated_at = datetime('now', '-3 hours')
    WHERE article_id = ? AND reviewer_id = ?
  `).bind(articleId, reviewerId).run();
  
  const existingReport = db.prepare('SELECT id FROM reports WHERE assignment_id = ?').bind(assignment.id).get();
  if (existingReport) {
    db.prepare(`
      UPDATE reports SET score=?, report=?, recommendation=?, updated_at=datetime('now', '-3 hours')
      WHERE assignment_id = ?
    `).bind(null, reportBody, normalizedRecommendation, assignment.id).run();
  } else {
    db.prepare(`
      INSERT INTO reports (assignment_id, score, report, recommendation, created_at, updated_at)
      VALUES (?, NULL, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
    `).bind(assignment.id, reportBody, normalizedRecommendation).run();
  }
  
  res.redirect('/reviewer');
});

module.exports = router;
