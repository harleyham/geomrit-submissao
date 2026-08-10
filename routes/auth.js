const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { loginLimiter } = require('../security/rate-limits');
const { validators: v, validateAndHandle } = require('../security/validation');
const { getAreas, getCursosByArea, getCursosMap } = require('../services/academic-formation');

function authenticatedDestination(req) {
  if (req.session.isAdmin) return '/admin/dashboard';
  if (req.session.isReviewer) return '/reviewer';
  if (req.session.isPublic) return '/author';
  return '/';
}

function normalizeCPF(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCPF(value) {
  const cpf = normalizeCPF(value);
  if (!cpf) return !String(value || '').trim();
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (base, factor) => {
    let total = 0;
    for (let index = 0; index < base.length; index += 1) {
      total += Number(base[index]) * (factor - index);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(cpf.slice(0, 9), 10) === Number(cpf[9])
    && calculateDigit(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function normalizeProfileForm(body = {}) {
  return {
    name: String(body.name || '').trim(),
    institution: String(body.institution || '').trim(),
    phone: String(body.phone || '').trim(),
    cpf: String(body.cpf || '').trim(),
    passport: String(body.passport || '').trim(),
    country: String(body.country || '').trim(),
    formacao_area: String(body.formacao_area || '').trim(),
    formacao_curso: String(body.formacao_curso || '').trim(),
    formacao_titulacao: String(body.formacao_titulacao || '').trim(),
    formacao_status: String(body.formacao_status || '').trim()
  };
}

function validateCompleteProfile(formData) {
  if (!formData.name || !formData.institution || !formData.phone || !formData.country) {
    return 'Preencha nome, instituição, telefone e país.';
  }
  if (formData.name.length > 200 || formData.institution.length > 200 || formData.phone.length > 30
      || formData.country.length > 100 || formData.passport.length > 50) {
    return 'Um ou mais dados pessoais excedem o tamanho permitido.';
  }
  if (!normalizeCPF(formData.cpf) && !formData.passport) {
    return 'Informe o CPF ou o passaporte.';
  }
  if (formData.cpf && !isValidCPF(formData.cpf)) {
    return 'O CPF informado é inválido.';
  }
  if (!formData.formacao_area || !formData.formacao_curso || !formData.formacao_titulacao || !formData.formacao_status) {
    return 'Preencha todos os campos de formação acadêmica.';
  }
  if (!getAreas().some((area) => area.codigo === formData.formacao_area)) {
    return 'A área de formação selecionada é inválida.';
  }
  if (!getCursosByArea(formData.formacao_area).includes(formData.formacao_curso)) {
    return 'O curso selecionado não pertence à área de formação informada.';
  }
  if (formData.formacao_curso.length > 200) {
    return 'O nome do curso excede o tamanho permitido.';
  }
  if (!['Graduado', 'Mestre', 'Doutor'].includes(formData.formacao_titulacao)) {
    return 'A titulação selecionada é inválida.';
  }
  if (!['Formado', 'Cursando'].includes(formData.formacao_status)) {
    return 'O status da formação é inválido.';
  }
  return null;
}

function renderCompleteProfile(res, user, formData, error = null) {
  return res.render('complete-profile', {
    title: 'Complete seu Perfil',
    user,
    formData,
    areas: getAreas(),
    cursosMap: getCursosMap(),
    error,
    success: null,
    year: new Date().getFullYear()
  });
}

function requireOnboarding(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  const user = db.prepare('SELECT password_changed, profile_completed FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  if (!user.password_changed) return res.redirect('/login/change-password');
  if (!user.profile_completed) return res.redirect('/login/complete-profile');
  next();
}

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
    const user = db.prepare('SELECT password_changed, profile_completed FROM users WHERE id = ?').get(req.session.userId);
    if (user && !user.password_changed) return res.redirect('/login/change-password');
    if (user && !user.profile_completed) return res.redirect('/login/complete-profile');
    return res.redirect(authenticatedDestination(req));
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
    return res.redirect('/login/change-password');
  }

  if (!user.profile_completed) return res.redirect('/login/complete-profile');
  return res.redirect(authenticatedDestination(req));
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
  const user = db.prepare('SELECT password_changed, profile_completed FROM users WHERE id = ?').bind(req.session.userId).get();
  if (user && user.password_changed) {
    if (!user.profile_completed) return res.redirect('/login/complete-profile');
    return res.redirect(authenticatedDestination(req));
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

  if (res.locals.validationErrors && res.locals.validationErrors.length) {
    return res.status(400).render('change-password', {
      title: 'Trocar Senha',
      action: 'change-password',
      success: null,
      error: res.locals.validationErrors[0],
      year: new Date().getFullYear()
    });
  }
  if (!new_password || new_password !== confirm_password) {
    return res.status(400).render('change-password', {
      title: 'Trocar Senha',
      action: 'change-password',
      success: null,
      error: 'As senhas não conferem.',
      year: new Date().getFullYear()
    });
  }

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password = ?, password_changed = 1, updated_at = datetime('now', '-3 hours') WHERE id = ?").bind(hash, req.session.userId).run();

  const user = db.prepare('SELECT profile_completed FROM users WHERE id = ?').get(req.session.userId);
  if (user && !user.profile_completed) return res.redirect('/login/complete-profile');
  return res.redirect(authenticatedDestination(req));
});

router.get('/complete-profile', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.prepare(`
    SELECT id, name, email, institution, phone, cpf, passport, country,
           formacao_area, formacao_curso, formacao_titulacao, formacao_status,
           password_changed, profile_completed
    FROM users WHERE id = ?
  `).get(req.session.userId);

  if (!user) return res.redirect('/login');
  if (!user.password_changed) return res.redirect('/login/change-password');
  if (user.profile_completed) return res.redirect(authenticatedDestination(req));
  return renderCompleteProfile(res, user, user);
});

router.post('/complete-profile', loginLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.completeProfile);
}, (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.prepare('SELECT id, email, password_changed, profile_completed FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.redirect('/login');
  if (!user.password_changed) return res.redirect('/login/change-password');
  if (user.profile_completed) return res.redirect(authenticatedDestination(req));

  const formData = normalizeProfileForm(req.body);
  const error = validateCompleteProfile(formData);
  if (error) return renderCompleteProfile(res, user, formData, error);

  db.prepare(`
    UPDATE users
    SET name = ?, institution = ?, phone = ?, cpf = ?, passport = ?, country = ?,
        formacao_area = ?, formacao_curso = ?, formacao_titulacao = ?, formacao_status = ?,
        profile_completed = 1, updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `).run(
    formData.name,
    formData.institution,
    formData.phone,
    normalizeCPF(formData.cpf) || null,
    formData.passport || null,
    formData.country,
    formData.formacao_area,
    formData.formacao_curso,
    formData.formacao_titulacao,
    formData.formacao_status,
    req.session.userId
  );

  req.session.userName = formData.name;
  req.session.userInstitution = formData.institution;
  return res.redirect(authenticatedDestination(req));
});

module.exports = { router, requireAuth, requireOnboarding };
