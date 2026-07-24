const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Middleware de autenticação
function requireReviewer(req, res, next) {
  if (!req.session.isReviewer) {
    return res.redirect('/reviewer/login');
  }
  next();
}

// Login do revisor
router.get('/login', (req, res) => {
  res.render('reviewer/login', {
    error: null,
    year: new Date().getFullYear()
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const reviewer = await db.prepare('SELECT * FROM reviewers WHERE email = ? AND password = ?').get(email, password);
  
  if (reviewer) {
    req.session.isReviewer = true;
    req.session.reviewerId = reviewer.id;
    req.session.reviewerName = reviewer.name;
    req.session.reviewerArea = reviewer.area;
    res.redirect('/reviewer');
  } else {
    res.render('reviewer/login', {
      error: 'Credenciais inválidas.',
      year: new Date().getFullYear()
    });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Dashboard do revisor
router.get('/', requireReviewer, async (req, res) => {
  const reviewerId = req.session.reviewerId;
  
  // Contar artigos atribuídos
  const stats = await db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM articles a
    INNER JOIN assignments ar ON a.id = ar.article_id
    WHERE ar.reviewer_id = ?
  `).get(reviewerId);
  
  // Artigos pendentes
  const pendingArticles = await db.prepare(`
    SELECT a.*
    FROM articles a
    INNER JOIN assignments ar ON a.id = ar.article_id
    WHERE ar.reviewer_id = ? AND a.status = 'pending'
    ORDER BY a.date_submitted DESC
    LIMIT 50
  `).all(reviewerId);
  
  // Artigos já revisados
  const reviewedArticles = await db.prepare(`
    SELECT a.*
    FROM articles a
    INNER JOIN assignments ar ON a.id = ar.article_id
    WHERE ar.reviewer_id = ? AND a.status IN ('approved', 'rejected')
    ORDER BY a.date_submitted DESC
    LIMIT 50
  `).all(reviewerId);
  
  res.render('reviewer/dashboard', {
    reviewer: {
      name: req.session.reviewerName,
      area: req.session.reviewerArea
    },
    stats: {
      total: stats.total,
      pending: stats.pending || 0,
      approved: stats.approved || 0,
      rejected: stats.rejected || 0
    },
    pendingArticles,
    reviewedArticles,
    year: new Date().getFullYear()
  });
});

// Ver artigo para revisão
router.get('/articles/:id', requireReviewer, async (req, res) => {
  const articleId = req.params.id;
  
  // Verificar se o artigo é do revisor
  const reviewerId = req.session.reviewerId;
  const assignment = await db.prepare(`
    SELECT * FROM assignments 
    WHERE article_id = ? AND reviewer_id = ?
  `).get(articleId, reviewerId);
  
  if (!assignment) {
    return res.render('reviewer/dashboard', {
      reviewer: { name: req.session.reviewerName, area: req.session.reviewerArea },
      stats: { total: 0, pending: 0, approved: 0, rejected: 0 },
      pendingArticles: [],
      reviewedArticles: [],
      year: new Date().getFullYear(),
      error: 'Artigo não pertence à sua lista de revisão.'
    });
  }
  
  const article = await db.prepare(`
    SELECT a.*, e.name as event_name, e.date_start as event_date_start
    FROM articles a
    LEFT JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `).get(articleId);
  
  if (!article) {
    return res.render('reviewer/dashboard', {
      reviewer: { name: req.session.reviewerName, area: req.session.reviewerArea },
      stats: { total: 0, pending: 0, approved: 0, rejected: 0 },
      pendingArticles: [],
      reviewedArticles: [],
      year: new Date().getFullYear(),
      error: 'Artigo não encontrado.'
    });
  }
  
  res.render('reviewer/article', {
    article,
    reviewer: { name: req.session.reviewerName, area: req.session.reviewerArea },
    year: new Date().getFullYear()
  });
});

// Submeter revisão
router.post('/articles/:id/review', requireReviewer, async (req, res) => {
  const articleId = req.params.id;
  const { status, review_notes, rejection_reason } = req.body;
  const reviewerId = req.session.reviewerId;
  
  // Verificar permissão
  const assignment = await db.prepare(`
    SELECT * FROM assignments 
    WHERE article_id = ? AND reviewer_id = ?
  `).get(articleId, reviewerId);
  
  if (!assignment) {
    return res.redirect('/reviewer');
  }
  
  // Atualizar artigo
  const stmt = db.prepare(`
    UPDATE articles 
    SET status = ?, reviewer_id = ?, reviewer_name = ?, reviewer_area = ?, review_notes = ?, rejection_reason = ?
    WHERE id = ?
  `);
  
  stmt.run(
    status,
    reviewerId,
    req.session.reviewerName,
    req.session.reviewerArea,
    review_notes,
    status === 'rejected' ? rejection_reason : null,
    articleId
  );
  
  // Atualizar data de revisão
  const updateAssignment = db.prepare(`
    UPDATE assignments SET reviewed_at = datetime('now') WHERE article_id = ? AND reviewer_id = ?
  `);
  updateAssignment.run(articleId, reviewerId);
  
  res.redirect('/reviewer');
});

module.exports = router;