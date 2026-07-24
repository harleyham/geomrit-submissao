const express = require('express');
const { db } = require('../db');
const bcrypt = require('bcryptjs');

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

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const reviewer = db.prepare('SELECT * FROM reviewers WHERE email = ? AND is_active = 1').get(email);
  
  if (reviewer && reviewer.password) {
    const valid = bcrypt.compareSync(password, reviewer.password);
    if (valid) {
      req.session.isReviewer = true;
      req.session.reviewerId = reviewer.id;
      req.session.reviewerName = reviewer.name;
      req.session.reviewerArea = reviewer.area;
      return res.redirect('/reviewer');
    }
  }
  
  res.render('reviewer/login', {
    error: 'Credenciais inválidas.',
    year: new Date().getFullYear()
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Dashboard do revisor
router.get('/', requireReviewer, (req, res) => {
  const reviewerId = req.session.reviewerId;
  
  // Contar artigos atribuídos
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END), 0) as approved,
      COALESCE(SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END), 0) as rejected
    FROM articles a
    INNER JOIN assignments ar ON a.id = ar.article_id
    WHERE ar.reviewer_id = ?
  `).get(reviewerId);
  
  // Artigos pendentes
  const pendingArticles = db.prepare(`
    SELECT a.*
    FROM articles a
    INNER JOIN assignments ar ON a.id = ar.article_id
    WHERE ar.reviewer_id = ? AND a.status = 'pending'
    ORDER BY a.date_submitted DESC
    LIMIT 50
  `).all(reviewerId);
  
  // Artigos já revisados
  const reviewedArticles = db.prepare(`
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
      pending: stats.pending,
      approved: stats.approved,
      rejected: stats.rejected
    },
    pendingArticles,
    reviewedArticles,
    year: new Date().getFullYear()
  });
});

// Ver artigo para revisão
router.get('/articles/:id', requireReviewer, (req, res) => {
  const articleId = req.params.id;
  const reviewerId = req.session.reviewerId;
  
  // Verificar se o artigo é do revisor
  const assignment = db.prepare(`
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
  
  const article = db.prepare(`
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
router.post('/articles/:id/review', requireReviewer, (req, res) => {
  const articleId = req.params.id;
  const { status, review_notes, rejection_reason } = req.body;
  const reviewerId = req.session.reviewerId;
  
  // Verificar permissão
  const assignment = db.prepare(`
    SELECT * FROM assignments 
    WHERE article_id = ? AND reviewer_id = ?
  `).get(articleId, reviewerId);
  
  if (!assignment) {
    return res.redirect('/reviewer');
  }
  
  // Atualizar artigo com dados da revisão
  db.prepare(`
    UPDATE articles 
    SET status = ?, reviewer_id = ?, reviewer_name = ?, reviewer_area = ?, 
        review_notes = ?, rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status,
    reviewerId,
    req.session.reviewerName,
    req.session.reviewerArea,
    review_notes,
    status === 'rejected' ? rejection_reason : null,
    articleId
  );
  
  // Atualizar data de revisão na atribuição
  db.prepare(`
    UPDATE assignments SET reviewed_at = datetime('now'), status = 'accepted', updated_at = datetime('now')
    WHERE article_id = ? AND reviewer_id = ?
  `).run(articleId, reviewerId);
  
  // Criar ou atualizar relatório na tabela de reports
  const existingReport = db.prepare('SELECT id FROM reports WHERE assignment_id = ?').get(assignment.id);
  if (existingReport) {
    db.prepare(`
      UPDATE reports SET score=?, report=?, recommendation=?, updated_at=datetime('now')
      WHERE assignment_id = ?
    `).run(null, review_notes, status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'revision_requested', assignment.id);
  } else {
    db.prepare(`
      INSERT INTO reports (assignment_id, score, report, recommendation, created_at, updated_at)
      VALUES (?, NULL, ?, ?, datetime('now'), datetime('now'))
    `).run(assignment.id, review_notes, status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'revision_requested');
  }
  
  res.redirect('/reviewer');
});

module.exports = router;