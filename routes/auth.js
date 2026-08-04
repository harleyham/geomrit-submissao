const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { loginLimiter } = require('../security/rate-limits');
const { validators: v, validateAndHandle } = require('../security/validation');

function getAuthorRegistrationCountWhere(whereClause = '', bindParams = []) {
  return db.prepare(`
    SELECT COUNT(DISTINCT CASE
      WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
      WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
      ELSE NULL
    END) as count
    FROM articles
    WHERE status != 'draft'
    ${whereClause}
  `).bind(...bindParams).get().count;
}

function getListenerRegistrationCountWhere(whereClause = '', bindParams = []) {
  return db.prepare(`
    SELECT COUNT(*) as count
    FROM event_registrations
    WHERE registration_type = 'listener'
    ${whereClause}
  `).bind(...bindParams).get().count;
}

// Middleware de autenticação admin
function requireAuth(req, res, next) {
  const hasEventAdminRole = req.session && req.session.userId && db.prepare("SELECT 1 FROM event_user_roles WHERE user_id=? AND role='admin' LIMIT 1").get(req.session.userId);
  const canBootstrap = req.session && req.session.userId && db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0 && db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId)?.is_admin;
  if (!req.session.isAdmin && !hasEventAdminRole && !canBootstrap) {
    return res.redirect('/login');
  }
  req.session.isAdmin = true;
  next();
}

// Login page
router.get('/', (req, res) => {
  if (req.session.isAdmin || req.session.isReviewer || req.session.isPublic) {
    if (req.session.isAdmin) return res.redirect('/admin/dashboard');
    if (req.session.isReviewer) return res.redirect('/reviewer');
    if (req.session.isPublic) return res.redirect('/author');
  }
  res.render('login', {
    error: null,
    year: new Date().getFullYear()
  });
});

// Dashboard admin
router.get('/dashboard', requireAuth, (req, res) => {
  const totalEvents = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
  const publishedEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'published'").get().count;
  const totalArticles = db.prepare("SELECT COUNT(*) as count FROM articles WHERE status != 'draft'").get().count;
  const articlesWithoutReviewer = db.prepare(`
    SELECT COUNT(DISTINCT a.id) as count
    FROM articles a
    LEFT JOIN assignments ass ON ass.article_id = a.id
    WHERE a.status NOT IN ('draft', 'approved', 'rejected')
      AND ass.id IS NULL
  `).get().count;
  const articlesUnderReview = db.prepare(`
    SELECT COUNT(DISTINCT a.id) as count
    FROM articles a
    JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE a.status NOT IN ('draft', 'approved', 'rejected')
      AND ass.status != 'declined'
      AND rp.id IS NULL
  `).get().count;
  const articlesReadyForDecision = db.prepare(`
    SELECT COUNT(DISTINCT a.id) as count
    FROM articles a
    WHERE a.status NOT IN ('draft', 'approved', 'rejected')
      AND EXISTS (
        SELECT 1
        FROM assignments ass
        WHERE ass.article_id = a.id
          AND ass.status != 'declined'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM assignments ass
        LEFT JOIN reports rp ON rp.assignment_id = ass.id
        WHERE ass.article_id = a.id
          AND ass.status != 'declined'
          AND rp.id IS NULL
      )
  `).get().count;
  const pendingArticles = articlesWithoutReviewer + articlesUnderReview + articlesReadyForDecision;
  const authorRegistrations = getAuthorRegistrationCountWhere();
  const listenerRegistrations = getListenerRegistrationCountWhere();
  const totalRegisteredParticipants = authorRegistrations + listenerRegistrations;
  const activeReviewers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_reviewer = 1 AND is_public = 1').get().count;
  const inactiveReviewers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_reviewer = 1 AND is_public = 0').get().count;
  const pendingUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE approval_status = 'pending'").get().count;
  const pendingReviewAssignmentArticles = db.prepare(`
    SELECT
      a.id,
      a.event_id,
      a.title,
      a.type,
      a.status,
      a.created_at,
      e.name as event_name
    FROM articles a
    JOIN events e ON e.id = a.event_id
    LEFT JOIN assignments ass ON ass.article_id = a.id
    WHERE a.status != 'draft'
      AND ass.id IS NULL
    ORDER BY COALESCE(a.date_submitted, a.created_at) DESC, a.created_at DESC
    LIMIT 10
  `).all();
  const inReviewArticles = db.prepare(`
    SELECT DISTINCT
      a.id,
      a.event_id,
      a.title,
      a.type,
      a.status,
      a.created_at,
      e.name as event_name
    FROM articles a
    JOIN events e ON e.id = a.event_id
    JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE a.status NOT IN ('draft', 'approved', 'rejected')
      AND ass.status != 'declined'
      AND rp.id IS NULL
    ORDER BY COALESCE(a.date_submitted, a.created_at) DESC, a.created_at DESC
    LIMIT 10
  `).all();
  const readyForDecisionArticles = db.prepare(`
    SELECT DISTINCT
      a.id,
      a.event_id,
      a.title,
      a.type,
      a.status,
      a.created_at,
      e.name as event_name
    FROM articles a
    JOIN events e ON e.id = a.event_id
    WHERE a.status NOT IN ('draft', 'approved', 'rejected')
      AND EXISTS (
        SELECT 1
        FROM assignments ass
        WHERE ass.article_id = a.id
          AND ass.status != 'declined'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM assignments ass
        LEFT JOIN reports rp ON rp.assignment_id = ass.id
        WHERE ass.article_id = a.id
          AND ass.status != 'declined'
          AND rp.id IS NULL
      )
    ORDER BY COALESCE(a.date_submitted, a.created_at) DESC, a.created_at DESC
    LIMIT 10
  `).all();
  const pendingSubsidyRequests = db.prepare(`
    SELECT
      er.id,
      er.event_id,
      er.name,
      er.email,
      er.institution,
      er.registration_type,
      er.created_at,
      e.name as event_name
    FROM event_registrations er
    JOIN events e ON e.id = er.event_id
    WHERE er.subsidy_requested = 1
      AND COALESCE(er.subsidy_status, 'pending') = 'pending'
    ORDER BY er.created_at DESC
    LIMIT 10
  `).all();
  const pendingRegistrationRequests = db.prepare(`
    SELECT
      id,
      name,
      email,
      institution,
      country,
      cpf,
      passport,
      created_at
    FROM users
    WHERE approval_status = 'pending'
    ORDER BY created_at DESC
    LIMIT 10
  `).all();
  
  res.render('admin/dashboard', {
    title: 'Dashboard',
    totalEvents,
    publishedEvents,
    totalArticles,
    pendingArticles,
    articlesWithoutReviewer,
    articlesUnderReview,
    articlesReadyForDecision,
    totalRegisteredParticipants,
    authorRegistrations,
    listenerRegistrations,
    activeReviewers,
    inactiveReviewers,
    pendingUsers,
    pendingReviewAssignmentArticles,
    inReviewArticles,
    readyForDecisionArticles,
    pendingSubsidyRequests,
    pendingRegistrationRequests,
    year: new Date().getFullYear()
  });
});

router.post('/', loginLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.login);
}, (req, res) => {
  const { email, password } = req.body;

  const bcrypt = require('bcryptjs');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').bind(email).get();

  if (!user) {
    return res.render('login', {
      error: 'Credenciais inválidas.',
      year: new Date().getFullYear()
    });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.render('login', {
      error: 'Credenciais inválidas.',
      year: new Date().getFullYear()
    });
  }

  if (user.approval_status === 'pending') {
    return res.render('login', {
      error: 'Seu cadastro ainda está pendente de validação por um administrador.',
      year: new Date().getFullYear()
    });
  }

  if (!user.is_public) {
    return res.render('login', {
      error: 'Conta desativada.',
      year: new Date().getFullYear()
    });
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.userInstitution = user.institution || '';
  req.session.userRoles = [];
  req.session.isAdmin = false;
  req.session.isReviewer = false;
  req.session.isPublic = false;

  const hasEventAdminRole = db.prepare("SELECT 1 FROM event_user_roles WHERE user_id=? AND role='admin' LIMIT 1").get(user.id);
  if (hasEventAdminRole || (user.is_admin && db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0)) {
    req.session.isAdmin = true;
    req.session.userRoles.push('admin');
  }

  if (user.is_reviewer) {
    req.session.isReviewer = true;
    req.session.userRoles.push('reviewer');
  }

  if (req.session.userRoles.length === 0) {
    req.session.isPublic = true;
  }

  if (!user.password_changed) {
    if (req.session.isAdmin || req.session.isReviewer) {
      return res.redirect('/login/change-password');
    }
    return res.redirect('/login/change-password');
  }

  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }

  if (req.session.isReviewer) {
    return res.redirect('/reviewer');
  }

  return res.redirect('/author');
});

// Logout (GET e POST)
router.get('/logout', (req, res) => {
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
    res.redirect('/login');
  });
});

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
    res.redirect('/login');
  });
});

// Trocar senha (primeiro acesso) - unificado
router.get('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.prepare('SELECT password_changed FROM users WHERE id = ?').bind(req.session.userId).get();
  if (user && user.password_changed) {
    if (req.session.isAdmin) return res.redirect('/admin/dashboard');
    if (req.session.isReviewer) return res.redirect('/reviewer');
    if (req.session.isPublic) return res.redirect('/author');
    return res.redirect('/');
  }
  res.render('change-password', { 
    title: 'Trocar Senha', 
    action: 'change-password',
    success: null,
    error: null,
    year: new Date().getFullYear()
  });
});

router.post('/change-password', loginLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.changePassword);
}, (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { new_password, confirm_password } = req.body;

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ?, password_changed = 1 WHERE id = ?').bind(hash, req.session.userId).run();

  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  if (req.session.isReviewer) {
    return res.redirect('/reviewer');
  }
  if (req.session.isPublic) {
    return res.redirect('/author');
  }
  return res.redirect('/');
});

module.exports = { router, requireAuth };
