const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { db } = require('../db');
const { loginLimiter, adminLimiter, strictLimiter } = require('../security/rate-limits');
const { validators: v, validateAndHandle } = require('../security/validation');
const { getAreas, getCursosByArea, getCursosMap, NO_DEGREE_COURSE } = require('../services/academic-formation');
const { resetDatabase } = require('../services/db-reset');
const { createBackupZip, restoreFromZip, backupFileName } = require('../services/backup');
const { requireSuperAdmin } = require('../security/super-admin');
const { validateCsrfToken } = require('../security/csrf');
const { getSystemEmailSettings, getPendingEmailCount, getPendingEmails, getSuppressedEmailCount, getSuppressedEmails, deleteSuppressedEmails, setSystemEmailEnabled, enqueueDirectEmail, clearEmailQueue } = require('../services/email');

const RESTORE_UPLOADS_DIR = path.join(os.tmpdir(), 'artigos-restore-uploads');
fs.mkdirSync(RESTORE_UPLOADS_DIR, { recursive: true });
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RESTORE_UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `restore-${Date.now()}.zip`)
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

function authenticatedDestination(req) {
  if (req.session.isAdmin) return '/admin/dashboard';
  if (req.session.userId && db.prepare("SELECT 1 FROM event_user_roles WHERE user_id=? AND role='staff' LIMIT 1").get(req.session.userId)) return '/admin/events';
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
  if (!formData.formacao_area || !formData.formacao_curso) {
    return 'Preencha a área e o curso de formação acadêmica.';
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
  const noDegree = formData.formacao_curso === NO_DEGREE_COURSE;
  if (!noDegree) {
    if (!formData.formacao_titulacao || !formData.formacao_status) {
      return 'Preencha a titulação e o status da formação acadêmica.';
    }
    if (!['Graduado', 'Mestre', 'Doutor'].includes(formData.formacao_titulacao)) {
      return 'A titulação selecionada é inválida.';
    }
    if (!['Formado', 'Cursando'].includes(formData.formacao_status)) {
      return 'O status da formação é inválido.';
    }
  }
  return null;
}

function normalizeFormacaoForStorage(formData) {
  if (formData.formacao_curso === NO_DEGREE_COURSE) {
    formData.formacao_titulacao = '';
    formData.formacao_status = '';
  }
  return formData;
}

function renderCompleteProfile(res, user, formData, error = null) {
  return res.render('complete-profile', {
    title: 'Complete seu Perfil',
    user,
    formData,
    areas: getAreas(),
    cursosMap: getCursosMap(),
    noDegreeCourse: NO_DEGREE_COURSE,
    error,
    success: null,
    year: new Date().getFullYear()
  });
}

// Conta inativa (is_public=0) não mantém sessão: qualquer request autenticado
// de um usuário inabilitado derruba a sessão e volta para o login.
function requireActiveAccount(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  const user = db.prepare('SELECT is_public FROM users WHERE id = ?').get(req.session.userId);
  if (user && !user.is_public) {
    return req.session.destroy(() => res.redirect('/login?error=' + encodeURIComponent('Sua conta está inativa. Se precisar desta conta, solicite à organização do evento que ela seja reativada.')));
  }
  next();
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

// Autoriza acesso a áreas administrativas restritas (eventos, artigos e
// relatórios). Administradores (sessão admin ou papel 'admin' em algum evento)
// seguem com acesso pleno. Usuários com papel 'staff' recebem acesso apenas
// aos eventos em que foram marcados como staff: `req.staffEventIds` lista esses
// eventos e é usado pelos routers para restringir consultas e ações. O staff
// não é promovido a sessão de admin (req.session.isAdmin continua false).
function getStaffEventIds(userId) {
  return db.prepare("SELECT event_id FROM event_user_roles WHERE user_id=? AND role='staff'").all(userId).map((row) => row.event_id);
}

function requireAdminOrStaff(req, res, next) {
  if (req.session && req.session.userId) {
    const hasEventAdminRole = db.prepare("SELECT 1 FROM event_user_roles WHERE user_id=? AND role='admin' LIMIT 1").get(req.session.userId);
    const canBootstrap = db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0 && db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId)?.is_admin;
    if (req.session.isAdmin || hasEventAdminRole || canBootstrap) {
      req.session.isAdmin = true;
      req.staffEventIds = null; // acesso irrestrito
      return next();
    }
    const staffEventIds = getStaffEventIds(req.session.userId);
    if (staffEventIds.length) {
      req.session.isEventStaff = true;
      req.staffEventIds = staffEventIds;
      return next();
    }
  }
  return res.redirect('/login');
}

function safeAfterLoginPath(value) {
  const path = String(value || '');
  if (!path.startsWith('/presenca/') || path.includes('//') || path.includes('\u0000') || path.length > 200) return null;
  return path;
}

// Login page
router.get('/', (req, res) => {
  const afterLogin = safeAfterLoginPath(req.query.next);
  if (afterLogin && req.session) req.session.afterLoginPath = afterLogin;
  if (req.session.isAdmin || req.session.isReviewer || req.session.isPublic) {
    const user = db.prepare('SELECT password_changed, profile_completed FROM users WHERE id = ?').get(req.session.userId);
    if (user && !user.password_changed) return res.redirect('/login/change-password');
    if (user && !user.profile_completed) return res.redirect('/login/complete-profile');
    return res.redirect(authenticatedDestination(req));
  }
  res.render('login', {
    error: req.query.error ? decodeURIComponent(req.query.error) : null,
    year: new Date().getFullYear()
  });
});

// Dashboard admin
router.get('/dashboard', requireAuth, (req, res) => {
  const isSuperAdmin = req.session.userEmail === 'admin@admin.com';
  const brToday = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const totalEvents = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
  const publishedEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'published'").get().count;
  const concludedEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE date_end IS NOT NULL AND date_end != '' AND date_end < ?").bind(brToday).get().count;
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const futureRegistrations = db.prepare(`
    SELECT COUNT(*) as count
    FROM event_registrations er
    JOIN events e ON e.id = er.event_id
    WHERE e.date_start IS NOT NULL AND e.date_start != '' AND e.date_start >= ?
  `).bind(brToday).get().count;
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
    concludedEvents,
    totalUsers,
    futureRegistrations,
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
    systemEmailSettings: getSystemEmailSettings(),
    pendingEmailCount: getPendingEmailCount(),
    pendingEmails: isSuperAdmin ? getPendingEmails() : [],
    suppressedEmailCount: getSuppressedEmailCount(),
    suppressedEmails: isSuperAdmin ? getSuppressedEmails() : [],
    year: new Date().getFullYear(),
    query: req.query
  });
});

router.post('/email-settings/toggle', requireAuth, requireSuperAdmin, strictLimiter, (req, res) => {
  const enabled = req.body.enabled === '1';
  const cancelled = setSystemEmailEnabled(enabled, req.session.userId);
  const message = enabled
    ? 'Envio global de e-mails ativado.'
    : `Envio global de e-mails desativado. ${cancelled} mensagem(ns) pendente(s) cancelada(s).`;
  const returnTo = req.body.return_to === 'events' ? '/admin/events' : '/admin/dashboard';
  return res.redirect(`${returnTo}?email=${enabled ? 'enabled' : 'disabled'}&message=${encodeURIComponent(message)}`);
});

router.post('/email/direct', requireAuth, requireSuperAdmin, strictLimiter, (req, res) => {
  const recipientEmail = String(req.body.recipient_email || '').trim().toLowerCase();
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(recipientEmail) || !subject || !body) {
    const message = 'Preencha corretamente: e-mail de destinatário válido, assunto e mensagem.';
    return res.redirect(`/admin/dashboard?email=error&message=${encodeURIComponent(message)}`);
  }
  enqueueDirectEmail({
    userId: req.session.userId,
    recipientEmail,
    recipientName: recipientEmail,
    subject,
    body
  });
  return res.redirect(`/admin/dashboard?email=sent&message=${encodeURIComponent('E-mail enfileirado para ' + recipientEmail + '. Ele será enviado quando o envio global estiver ativado.')}`);
});

router.post('/email/clear', requireAuth, requireSuperAdmin, strictLimiter, (req, res) => {
  const cleared = clearEmailQueue(req.session.userId);
  return res.redirect(`/admin/dashboard?email=cleared&message=${encodeURIComponent('Fila de e-mails limpa. ' + cleared + ' mensagem(ns) cancelada(s).')}`);
});

router.get('/email/pending-list', requireAuth, requireSuperAdmin, (req, res) => {
  const pendingEmailCount = getPendingEmailCount();
  const pendingEmails = getPendingEmails();
  res.render('partials/email-queue', { pendingEmailCount, pendingEmails }, (err, html) => {
    if (err) return res.status(500).json({ error: 'Erro ao renderizar a fila de e-mails.' });
    res.json({ count: pendingEmailCount, html });
  });
});

router.get('/email/suppressed-list', requireAuth, requireSuperAdmin, (req, res) => {
  const suppressedEmailCount = getSuppressedEmailCount();
  const suppressedEmails = getSuppressedEmails();
  res.render('partials/email-suppressed', { suppressedEmailCount, suppressedEmails }, (err, html) => {
    if (err) return res.status(500).json({ error: 'Erro ao renderizar a lista de e-mails suprimidos.' });
    res.json({ count: suppressedEmailCount, html });
  });
});

router.post('/email/suppressed/delete', requireAuth, requireSuperAdmin, strictLimiter, (req, res) => {
  const deleted = deleteSuppressedEmails(req.session.userId);
  return res.redirect(`/admin/dashboard?email=suppressed-deleted&message=${encodeURIComponent('Lista de e-mails suprimidos excluída. ' + deleted + ' mensagem(ns) removida(s).')}`);
});

router.get('/db/reset', requireAuth, requireSuperAdmin, (req, res) => {
  return res.render('admin/db-reset-confirm', {
    title: 'Resetar Banco de Dados',
    year: new Date().getFullYear()
  });
});

router.post('/db/reset', requireAuth, requireSuperAdmin, adminLimiter, (req, res) => {
  try {
    resetDatabase();
    req.flash ? req.flash('success', 'Banco de dados resetado com sucesso. O servidor será reiniciado.') : null;
    return res.redirect('/admin/dashboard?reset=success');
  } catch (err) {
    console.error('DB Reset error:', err);
    return res.redirect('/admin/dashboard?reset=error');
  }
});

// Download do backup (banco + uploads) em ZIP
router.get('/backup/download', requireAuth, requireSuperAdmin, async (req, res) => {
  const tmpZip = path.join(os.tmpdir(), `artigos-backup-out-${Date.now()}.zip`);
  try {
    await createBackupZip(tmpZip);
    const fileName = backupFileName();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(tmpZip, (err) => {
      fs.unlink(tmpZip, () => {});
      if (err && !res.headersSent) {
        res.status(500).render('error', { title: 'Erro', message: 'Falha ao gerar o backup.' });
      }
    });
  } catch (err) {
    console.error('Backup error:', err);
    fs.unlink(tmpZip, () => {});
    if (!res.headersSent) {
      res.status(500).render('error', { title: 'Erro', message: 'Falha ao gerar o backup.' });
    }
  }
});

// Página de confirmação da restauração
router.get('/backup/restore', requireAuth, requireSuperAdmin, (req, res) => {
  return res.render('admin/backup-restore', {
    title: 'Restaurar Backup',
    error: req.query.error || null,
    year: new Date().getFullYear()
  });
});

// Restauração: upload do ZIP gerado pelo backup
router.post('/backup/restore', requireAuth, requireSuperAdmin, strictLimiter, restoreUpload.single('backup_file'), validateCsrfToken, (req, res) => {
  const confirmText = String(req.body.confirm || '').trim();
  const uploadedFile = req.file ? req.file.path : null;
  try {
    if (!req.file) {
      return res.redirect('/admin/backup/restore?error=Arquivo%20de%20backup%20não%20enviado.');
    }
    if (confirmText !== 'RESTAURAR') {
      return res.redirect('/admin/backup/restore?error=Texto%20de%20confirmação%20inválido.');
    }
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    if (!/\.zip$/i.test(originalName)) {
      return res.redirect('/admin/backup/restore?error=Envie%20um%20arquivo%20ZIP%20gerado%20pelo%20backup.');
    }
    restoreFromZip(uploadedFile);
    return res.redirect('/admin/dashboard?restore=success');
  } catch (err) {
    console.error('Restore error:', err);
    const message = encodeURIComponent(err.message || 'Falha ao restaurar o backup.');
    return res.redirect(`/admin/backup/restore?error=${message}`);
  } finally {
    if (uploadedFile) fs.unlink(uploadedFile, () => {});
  }
});

router.post('/', loginLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.login);
}, (req, res, next) => {
  // Prev session fixation: regeneramos o ID da sessão assim que a
  // credencial é verificada, antes de associar o usuário à sessão. Um
  // atacante que tenha fixado um cookie connect.sid perde o acesso porque o
  // novo ID passa a apontar para uma sessão vazia e nova.
  const prevNext = req.session && req.session.afterLoginPath;
  req.session.regenerate((err) => {
    if (err) return next(err);
    // A regeneração zera o conteúdo da sessão; reconectamos o destino
    // pós-login (?next=) que estava salvo antes do login.
    if (prevNext) req.session.afterLoginPath = prevNext;
    // A sessão nova nasce sem csrfToken (e o res.locals ainda guarda o token
    // da sessão anterior). Sem isso, a página re-renderizada após uma
    // tentativa malsucedida exibia um token inválido e a próxima submissão
    // caía em 403. Um token novo por sessão mantém a rotação pós-login.
    req.session.csrfToken = require('../security/csrf').generateToken();
    res.locals.csrfToken = req.session.csrfToken;
    doLoginAfterRegen(req, res);
  });
});

function doLoginAfterRegen(req, res) {
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
  const afterLogin = safeAfterLoginPath(req.session.afterLoginPath);
  if (afterLogin) {
    delete req.session.afterLoginPath;
    return res.redirect(afterLogin);
  }
  return res.redirect(authenticatedDestination(req));
}

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
  normalizeFormacaoForStorage(formData);

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
    formData.formacao_titulacao || null,
    formData.formacao_status || null,
    req.session.userId
  );

  req.session.userName = formData.name;
  req.session.userInstitution = formData.institution;
  return res.redirect(authenticatedDestination(req));
});

module.exports = { router, requireAuth, requireAdminOrStaff, getStaffEventIds, requireOnboarding, requireActiveAccount };
