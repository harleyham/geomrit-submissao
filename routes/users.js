const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const PROTECTED_ADMIN_EMAIL = 'admin@admin.com';
const { strictLimiter } = require('../security/rate-limits');
const { validators: v, validateAndHandle } = require('../security/validation');
const { getAreas, getCursosMap, NO_DEGREE_COURSE } = require('../services/academic-formation');
const { queueAccountApproved, createImportBatch, getImportBatchEmailSummary, authorizeImportBatch,
  getSystemEmailSettings } = require('../services/email');

const importUploadDir = path.join(__dirname, '..', 'uploads', 'import');
if (!fs.existsSync(importUploadDir)) fs.mkdirSync(importUploadDir, { recursive: true });
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, importUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

function parseCsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());

  const parseLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          values.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    values.push(current);
    return values.map(v => v.trim().replace(/^"|"$/g, '').trim());
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    return obj;
  });
}

function parseImportCsvContent(content) {
  const semiCount = (content.split('\n')[0].match(/;/g) || []).length;
  const commaCount = (content.split('\n')[0].match(/,/g) || []).length;
  const delimiter = semiCount > commaCount ? ';' : ',';

  const headers = [];
  const rows = [];
  let pos = 0;
  const len = content.length;

  const skipLineEnding = () => {
    if (pos >= len) return;
    const ch = content[pos];
    if (ch === '\r') {
      if (pos + 1 < len && content[pos + 1] === '\n') pos += 2;
      else pos++;
    } else if (ch === '\n') {
      pos++;
    }
  };

  const readField = () => {
    let field = '';
    let inQuotes = false;
    while (pos < len) {
      const ch = content[pos];
      if (inQuotes) {
        if (ch === '"') {
          if (pos + 1 < len && content[pos + 1] === '"') { field += '"'; pos += 2; }
          else { inQuotes = false; pos++; }
        } else { field += ch; pos++; }
      } else {
        if (ch === '"') { inQuotes = true; pos++; }
        else if (ch === delimiter) { return field; }
        else if (ch === '\r' || ch === '\n') { return field; }
        else { field += ch; pos++; }
      }
    }
    return field;
  };

  const readLine = () => {
    if (pos >= len) return null;
    const line = [readField()];
    while (pos < len && content[pos] === delimiter) { pos++; line.push(readField()); }
    skipLineEnding();
    if (line.every((f) => f.trim() === '')) return null;
    return line;
  };

  const headerLine = readLine();
  if (!headerLine) return { headers: [], rows: [] };
  for (const h of headerLine) headers.push(h.replace(/^\uFEFF/, '').trim());

  let line;
  while ((line = readLine()) !== null) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (idx < line.length ? line[idx] : '').trim(); });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  }

  return { headers, rows };
}

function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

function parseToggleValue(value) {
  return value === '1' || value === 1 || value === true || value === 'true' ? 1 : 0;
}

function getCertificateProfileFlags(body) {
  return {
    is_participant: body.is_participant ? 1 : 0,
    is_speaker: body.is_speaker ? 1 : 0,
    is_teacher: body.is_teacher ? 1 : 0,
    is_oral_presenter: body.is_oral_presenter ? 1 : 0,
    is_poster_presenter: body.is_poster_presenter ? 1 : 0
  };
}

function getActiveAdminCount() {
  return db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1 AND is_public = 1').get().count;
}

function isRemovingLastActiveAdmin(currentUser, nextIsAdmin, nextIsPublic) {
  const currentlyActiveAdmin = currentUser.is_admin === 1 && currentUser.is_public === 1;
  const willRemainActiveAdmin = nextIsAdmin === 1 && nextIsPublic === 1;

  return currentlyActiveAdmin && !willRemainActiveAdmin && getActiveAdminCount() <= 1;
}

function getNextApprovalStatus(currentStatus, nextIsPublic) {
  if (currentStatus === 'pending' && nextIsPublic === 1) {
    return 'approved';
  }
  return currentStatus || 'approved';
}

function normalizeCPF(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCPF(value) {
  const cpf = normalizeCPF(value);

  if (!cpf) return true;
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (base, factor) => {
    let total = 0;
    for (let index = 0; index < base.length; index += 1) {
      total += Number(base[index]) * (factor - index);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const digit1 = calcDigit(cpf.slice(0, 9), 10);
  const digit2 = calcDigit(cpf.slice(0, 10), 11);

  return digit1 === Number(cpf[9]) && digit2 === Number(cpf[10]);
}

function normalizeReviewerAreas(value) {
  return Array.from(new Set(
    String(value || '')
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )).join(', ');
}

function parseAreaList(areaValue) {
  return String(areaValue || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function withAreaMeta(event) {
  if (!event) return event;
  const areaList = parseAreaList(event.area);
  return {
    ...event,
    area_list: areaList,
    area_display: areaList.join(' · ') || 'Sem área definida'
  };
}

function getSubmissionWindow(event) {
  if (!event.has_article_submission) {
    return {
      isOpen: false,
      isConfigured: false,
      start: null,
      end: null
    };
  }

  const now = new Date();
  const start = event.submission_start ? new Date(`${event.submission_start}T00:00:00`) : null;
  const end = event.submission_end ? new Date(`${event.submission_end}T23:59:59`) : null;

  return {
    isOpen: !!(start && end && now >= start && now <= end),
    isConfigured: !!(start && end),
    start,
    end
  };
}

function withSubmissionMeta(event) {
  const submission = getSubmissionWindow(event);
  const formatDate = (value) => {
    if (!value) return null;
    const date = new Date(String(value).slice(0, 10) + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
  };

  return {
    ...event,
    formattedDateStart: formatDate(event.date_start),
    formattedDateEnd: formatDate(event.date_end),
    submission,
    submissionDisplay: {
      start: submission.start ? formatDate(submission.start) : null,
      end: submission.end ? formatDate(submission.end) : null
    }
  };
}

function mapArticleStatus(status) {
  const labels = {
    draft: 'Rascunho',
    pending: 'Pendente',
    in_review: 'Em revisão',
    approved: 'Aprovado',
    rejected: 'Rejeitado'
  };
  return labels[status] || status;
}

router.get('/', requireAuth, (req, res) => {
  const perPage = Math.min(parseInt(req.query.per_page) || 50, 200);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const query = String(req.query.q || '').trim();
  const conditions = ["approval_status != 'pending'"];
  const params = [];

  if (query) {
    const term = `%${query.toLowerCase()}%`;
    conditions.push('(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(COALESCE(institution, \'\')) LIKE ? OR LOWER(COALESCE(cpf, \'\')) LIKE ?)');
    params.push(term, term, term, term);
  }

  const whereClause = conditions.join(' AND ');
  const totalApproved = db.prepare(`SELECT COUNT(*) as count FROM users WHERE ${whereClause}`).bind(...params).get().count;
  const totalPages = Math.max(1, Math.ceil(totalApproved / perPage));
  const clampedPage = Math.min(page, totalPages);
  const clampedOffset = (clampedPage - 1) * perPage;

  const allPending = db.prepare(`
    SELECT id, name, email, cpf, passport, country, institution, phone,
           is_admin, is_reviewer, is_participant, is_speaker, is_teacher, is_oral_presenter, is_poster_presenter, is_public, approval_status, approved_at,
           password_changed, profile_completed, created_at
    FROM users
    WHERE approval_status = 'pending'
    ORDER BY name
  `).all();

  const paginatedApproved = db.prepare(`
    SELECT id, name, email, cpf, passport, country, institution, phone,
           is_admin, is_reviewer, is_participant, is_speaker, is_teacher, is_oral_presenter, is_poster_presenter, is_public, approval_status, approved_at,
           password_changed, profile_completed, created_at
    FROM users
    WHERE ${whereClause}
    ORDER BY name
    LIMIT ? OFFSET ?
  `).bind(...params, perPage, clampedOffset).all();

  const currentUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(req.session.userId).get();
  res.render('admin/users/list', {
    pendingUsers: allPending,
    approvedUsers: paginatedApproved,
    currentUser,
    pagination: {
      currentPage: clampedPage,
      totalPages,
      totalApproved,
      perPage,
      hasNext: clampedPage < totalPages,
      hasPrev: clampedPage > 1
    },
    filters: { query },
    title: 'Usuários',
    year: new Date().getFullYear(),
    success: req.query.success,
    error: req.query.error
  });
});

router.get('/new', requireAuth, (req, res) => {
  const areas = getAreas();
  const cursosMap = getCursosMap();
  res.render('admin/users/form', {
    user: null,
    title: 'Novo Usuário',
    year: new Date().getFullYear(),
    areas: areas,
    formacaoAreas: areas,
    cursosMap: cursosMap,
    noDegreeCourse: NO_DEGREE_COURSE
  });
});

router.post('/', requireAuth, strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.userForm);
}, (req, res) => {
  const { name, email, password, cpf, passport, country, institution, phone, reviewer_areas, is_admin, is_reviewer, formacao_area, formacao_curso, formacao_titulacao, formacao_status } = req.body;
  const certificateProfiles = getCertificateProfileFlags(req.body);
  const normalizedReviewerAreas = normalizeReviewerAreas(reviewer_areas);
  const areas = getAreas();
  const cursosMap = getCursosMap();

  if (!email || !password) {
    return res.render('admin/users/form', {
      user: { name, email, cpf, passport, country, institution, phone: phone || '', reviewer_areas: normalizedReviewerAreas, is_admin, is_reviewer, ...certificateProfiles, formacao_area, formacao_curso, formacao_titulacao, formacao_status },
      title: 'Novo Usuário',
      year: new Date().getFullYear(),
      areas: areas,
      formacaoAreas: areas,
      cursosMap: cursosMap,
      noDegreeCourse: NO_DEGREE_COURSE,
      error: 'E-mail e senha são obrigatórios.'
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(email).get();
  if (existing) {
    return res.render('admin/users/form', {
      user: { name, email, cpf, passport, country, institution, phone: phone || '', reviewer_areas: normalizedReviewerAreas, is_admin, is_reviewer, ...certificateProfiles, formacao_area, formacao_curso, formacao_titulacao, formacao_status },
      title: 'Novo Usuário',
      year: new Date().getFullYear(),
      areas: areas,
      formacaoAreas: areas,
      cursosMap: cursosMap,
      noDegreeCourse: NO_DEGREE_COURSE,
      error: 'Já existe um usuário com o e-mail ' + email
    });
  }

  if (!isValidCPF(cpf)) {
    return res.render('admin/users/form', {
      user: { name, email, cpf, passport, country, institution, phone: phone || '', reviewer_areas: normalizedReviewerAreas, is_admin, is_reviewer, ...certificateProfiles, formacao_area, formacao_curso, formacao_titulacao, formacao_status },
      title: 'Novo Usuário',
      year: new Date().getFullYear(),
      areas: areas,
      formacaoAreas: areas,
      cursosMap: cursosMap,
      noDegreeCourse: NO_DEGREE_COURSE,
      error: 'O CPF informado é inválido.'
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const createdUser = db.prepare(`
    INSERT INTO users (name, email, password, cpf, passport, country, institution, phone, reviewer_areas,
      is_admin, is_reviewer, is_participant, is_speaker, is_teacher, is_oral_presenter, is_poster_presenter, is_public, approval_status, approved_at, password_changed, created_at, updated_at,
      formacao_area, formacao_curso, formacao_titulacao, formacao_status, profile_completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'approved', datetime('now', '-3 hours'), 0, datetime('now', '-3 hours'), datetime('now', '-3 hours'),
      ?, ?, ?, ?, 0)
  `).bind(
    name || email,
    email,
    hash,
    normalizeCPF(cpf) || null,
    passport || null,
    country || null,
    institution || null,
    phone || null,
    normalizedReviewerAreas || null,
    is_admin ? 1 : 0, is_reviewer ? 1 : 0,
    certificateProfiles.is_participant, certificateProfiles.is_speaker, certificateProfiles.is_teacher,
    certificateProfiles.is_oral_presenter, certificateProfiles.is_poster_presenter,
    formacao_area || null,
    formacao_curso || null,
    formacao_curso === NO_DEGREE_COURSE ? null : (formacao_titulacao || null),
    formacao_curso === NO_DEGREE_COURSE ? null : (formacao_status || null)
  ).run();

  queueAccountApproved({ id: createdUser.lastInsertRowid, name: name || email, email });

  res.redirect('/admin/users?success=Usuário criado com sucesso');
});

router.get('/:id/edit', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(req.params.id).get();
  if (!user) return res.status(404).render('error', { title: 'Usuário não encontrado' });
  const managedEvents = db.prepare(`SELECT e.id,e.name,e.date_start FROM events e JOIN event_user_roles eur ON eur.event_id=e.id WHERE eur.user_id=? AND eur.role='admin' ORDER BY e.date_start DESC,e.name`).all(req.session.userId);
  const selectedEventId = managedEvents.some((event) => event.id === Number(req.query.event_id)) ? Number(req.query.event_id) : (managedEvents[0] && managedEvents[0].id);
  const eventRoles = selectedEventId ? db.prepare('SELECT role,article_id FROM event_user_roles WHERE event_id=? AND user_id=?').all(selectedEventId, user.id) : [];
  const approvedArticles = selectedEventId ? db.prepare("SELECT id,title,type FROM articles WHERE event_id=? AND status='approved' ORDER BY title").all(selectedEventId) : [];
  const areas = getAreas();
  const cursosMap = getCursosMap();
  res.render('admin/users/form', {
    user,
    managedEvents, selectedEventId, eventRoles, approvedArticles,
    title: 'Editar Usuário',
    year: new Date().getFullYear(),
    success: req.query.success || null,
    error: req.query.error || null,
    areas: areas,
    formacaoAreas: areas,
    cursosMap: cursosMap,
    noDegreeCourse: NO_DEGREE_COURSE
  });
});

router.post('/:id/event-roles', requireAuth, (req, res) => {
  const userId = Number(req.params.id), eventId = Number(req.body.event_id);
  const allowed = db.prepare("SELECT 1 FROM event_user_roles WHERE event_id=? AND user_id=? AND role='admin'").get(eventId, req.session.userId);
  if (!allowed) return res.status(403).render('error', { title: 'Acesso negado', message: 'Você não administra este evento.' });
  const roles = Array.isArray(req.body.roles) ? req.body.roles : [req.body.roles];
  const valid = ['admin','participant','reviewer','speaker','teacher','oral_presenter','poster_presenter'];
  const selected = valid.filter((role) => roles.includes(role));
  const currentAdmins = db.prepare("SELECT COUNT(*) AS count FROM event_user_roles WHERE event_id=? AND role='admin'").get(eventId).count;
  const removingSelfAdmin = !selected.includes('admin') && db.prepare("SELECT 1 FROM event_user_roles WHERE event_id=? AND user_id=? AND role='admin'").get(eventId,userId);
  if (removingSelfAdmin && currentAdmins <= 1) return res.redirect(`/admin/users/${userId}/edit?event_id=${eventId}&error=${encodeURIComponent('O evento precisa manter ao menos um administrador.')}`);
  db.transaction(() => { db.prepare('DELETE FROM event_user_roles WHERE event_id=? AND user_id=?').run(eventId,userId); const insert=db.prepare('INSERT INTO event_user_roles(event_id,user_id,role,article_id,assigned_by) VALUES(?,?,?,?,?)'); selected.forEach((role)=>{const articleId=role==='oral_presenter'?Number(req.body.oral_article_id)||null:role==='poster_presenter'?Number(req.body.poster_article_id)||null:null; insert.run(eventId,userId,role,articleId,req.session.userId);}); })();
  res.redirect(`/admin/users/${userId}/edit?event_id=${eventId}&success=${encodeURIComponent('Perfis do evento atualizados.')}`);
});

router.get('/:id/participant', requireAuth, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const previewUser = db.prepare(`
    SELECT id, name, email, institution, is_public, is_admin, is_reviewer
    FROM users
    WHERE id = ?
  `).bind(userId).get();

  if (!previewUser) {
    return res.status(404).render('error', { title: 'Usuário não encontrado', message: 'O usuário solicitado não foi encontrado.' });
  }

  if (!previewUser.is_public) {
    return res.status(400).render('error', { title: 'Conta inativa', message: 'A conta deste usuário está inativa. Reative-a em /admin/users para visualizar a área do participante.' });
  }

  // Prévia: as rotas públicas passam a agir em nome do usuário pré-visualizado
  // (middleware em server.js restaura a identidade do admin em /admin/*).
  req.session.realIdentity = {
    userId: req.session.userId,
    userName: req.session.userName,
    userEmail: req.session.userEmail,
    userInstitution: req.session.userInstitution,
    isPublic: req.session.isPublic,
    isAdmin: req.session.isAdmin,
    isReviewer: req.session.isReviewer
  };
  req.session.previewUserId = previewUser.id;
  req.session.userId = previewUser.id;
  req.session.userName = previewUser.name;
  req.session.userEmail = previewUser.email;
  req.session.userInstitution = previewUser.institution || '';
  req.session.isPublic = true;
  req.session.isAdmin = !!previewUser.is_admin;
  req.session.isReviewer = !!previewUser.is_reviewer;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const participationKeys = db.prepare(`
    SELECT DISTINCT event_id
    FROM event_registrations
    WHERE user_id = ?
       OR LOWER(TRIM(email)) = LOWER(TRIM(?))
  `).bind(previewUser.id, previewUser.email).all();

  const registeredEventIds = new Set(participationKeys.map((row) => Number(row.event_id)));

  const participantEvents = db.prepare(`
    SELECT *
    FROM events
    WHERE status = 'published'
    ORDER BY date_start DESC
  `).all()
    .filter((event) => !registeredEventIds.has(Number(event.id)))
    .filter((event) => {
      if (!event.date_start) return false;
      const eventStart = new Date(`${event.date_start}T00:00:00`);
      return !Number.isNaN(eventStart.getTime()) && eventStart > today;
    })
    .map((event) => withSubmissionMeta(withAreaMeta(event)));

  const submissions = db.prepare(`
    SELECT a.*, e.name as event_name, e.date_start, e.date_end
    FROM articles a
    JOIN events e ON e.id = a.event_id
    WHERE a.submitter_user_id = ?
       OR (a.submitter_user_id IS NULL AND a.email_submission = ?)
    ORDER BY a.created_at DESC
  `).bind(previewUser.id, previewUser.email).all().map((article) => ({
    ...article,
    status_label: mapArticleStatus(article.status)
  }));

  const participations = db.prepare(`
    WITH approved_articles AS (
      SELECT
        event_id,
        CASE
          WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
          WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
          ELSE NULL
        END as participant_key,
        COUNT(*) as approved_count
      FROM articles
      WHERE status = 'approved'
      GROUP BY event_id, participant_key
    )
    SELECT
      er.*,
      e.name as event_name,
      e.date_start,
      e.date_end,
      e.location,
      e.status as event_status,
      COALESCE(aa.approved_count, 0) as approved_articles,
      CASE
        WHEN COALESCE(aa.approved_count, 0) > 0 THEN 'Apresentador com artigo aprovado'
        WHEN er.registration_type = 'author' THEN 'Participante com artigo submetido'
        ELSE 'Participante inscrito'
      END as participation_label
    FROM event_registrations er
    JOIN events e ON e.id = er.event_id
    LEFT JOIN approved_articles aa
      ON aa.event_id = er.event_id
     AND aa.participant_key = CASE
       WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
       ELSE 'email:' || LOWER(TRIM(er.email))
     END
    WHERE er.user_id = ?
       OR LOWER(TRIM(er.email)) = LOWER(TRIM(?))
    ORDER BY e.date_start DESC, er.created_at DESC
  `).bind(previewUser.id, previewUser.email).all().map((participation) => ({
    ...participation,
    can_cancel: false
  }));

  const showSubsidyStatus = participations.some((p) => !!p.subsidy_requested);

  const stats = {
    total: submissions.length,
    drafts: submissions.filter((item) => item.status === 'draft').length,
    pending: submissions.filter((item) => item.status === 'pending' || item.status === 'in_review').length,
    approved: submissions.filter((item) => item.status === 'approved').length,
    rejected: submissions.filter((item) => item.status === 'rejected').length
  };

  res.render('public/author-dashboard', {
    title: `Área do Participante - ${previewUser.name || previewUser.email}`,
    participantEvents,
    participations,
    submissions,
    stats,
    success: null,
    error: null,
    previewMode: true,
    previewUser,
    showSubsidyStatus: showSubsidyStatus,
    userName: previewUser.name,
    userEmail: previewUser.email,
    year: new Date().getFullYear()
  });
});

function updateUser(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, email, password, cpf, passport, country, institution, phone, reviewer_areas, is_admin, is_reviewer, formacao_area, formacao_curso, formacao_titulacao, formacao_status } = req.body;
  const certificateProfiles = getCertificateProfileFlags(req.body);
  const normalizedReviewerAreas = normalizeReviewerAreas(reviewer_areas);
  const user = db.prepare('SELECT id, name, email, is_admin, is_public, approval_status FROM users WHERE id = ?').bind(id).get();

  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  const displayName = name || user.name;
  const displayEmail = email || user.email;
  const nextIsAdmin = is_admin ? 1 : 0;
  if (isRemovingLastActiveAdmin(user, nextIsAdmin, user.is_public)) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  if (!isValidCPF(cpf)) {
    const areas = getAreas();
    const cursosMap = getCursosMap();
    return res.render('admin/users/form', {
      user: { id, name: displayName, email, cpf, passport, country, institution, phone: phone || '', reviewer_areas: normalizedReviewerAreas, is_admin, is_reviewer, ...certificateProfiles, formacao_area, formacao_curso, formacao_titulacao, formacao_status },
      title: 'Editar Usuário',
      year: new Date().getFullYear(),
      areas: areas,
      formacaoAreas: areas,
      cursosMap: cursosMap,
      noDegreeCourse: NO_DEGREE_COURSE,
      error: 'O CPF informado é inválido.'
    });
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      UPDATE users SET name=?, email=?, password=?, cpf=?, passport=?, country=?, institution=?, phone=?, reviewer_areas=?,
        is_admin=?, is_reviewer=?, is_participant=?, is_speaker=?, is_teacher=?, is_oral_presenter=?, is_poster_presenter=?, password_changed=0, updated_at=datetime('now', '-3 hours'),
        formacao_area=?, formacao_curso=?, formacao_titulacao=?, formacao_status=?
      WHERE id=?
     `).bind(
       displayName, displayEmail, hash,
      normalizeCPF(cpf) || null, passport || null, country || null, institution || null, phone || null, normalizedReviewerAreas || null,
      nextIsAdmin, is_reviewer ? 1 : 0, certificateProfiles.is_participant, certificateProfiles.is_speaker, certificateProfiles.is_teacher, certificateProfiles.is_oral_presenter, certificateProfiles.is_poster_presenter,
      formacao_area || null, formacao_curso || null, formacao_curso === NO_DEGREE_COURSE ? null : (formacao_titulacao || null), formacao_curso === NO_DEGREE_COURSE ? null : (formacao_status || null),
      id
    ).run();
  } else {
    db.prepare(`
      UPDATE users SET name=?, email=?, cpf=?, passport=?, country=?, institution=?, phone=?, reviewer_areas=?,
        is_admin=?, is_reviewer=?, is_participant=?, is_speaker=?, is_teacher=?, is_oral_presenter=?, is_poster_presenter=?, updated_at=datetime('now', '-3 hours'),
        formacao_area=?, formacao_curso=?, formacao_titulacao=?, formacao_status=?
      WHERE id=?
     `).bind(
       displayName, displayEmail,
      normalizeCPF(cpf) || null, passport || null, country || null, institution || null, phone || null, normalizedReviewerAreas || null,
      nextIsAdmin, is_reviewer ? 1 : 0, certificateProfiles.is_participant, certificateProfiles.is_speaker, certificateProfiles.is_teacher, certificateProfiles.is_oral_presenter, certificateProfiles.is_poster_presenter,
      formacao_area || null, formacao_curso || null, formacao_curso === NO_DEGREE_COURSE ? null : (formacao_titulacao || null), formacao_curso === NO_DEGREE_COURSE ? null : (formacao_status || null),
      id
    ).run();
  }

  res.redirect('/admin/users?success=Usuário atualizado');
}

// Formulários HTML enviam POST. Mantemos PUT também para integrações que já
// utilizavam method-override, sem depender dele para a interface administrativa.
router.post('/:id(\\d+)', requireAuth, (req, res, next) => {
  validateAndHandle(req, res, next, v.userForm);
}, updateUser);
router.put('/:id(\\d+)', requireAuth, (req, res, next) => {
  validateAndHandle(req, res, next, v.userForm);
}, updateUser);

router.delete('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id, email, is_admin, is_public FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  if (user.email === PROTECTED_ADMIN_EMAIL) {
    return res.redirect('/admin/users?error=A conta administrativa padrão não pode ser excluída');
  }

  if (isRemovingLastActiveAdmin(user, 0, 0)) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  res.redirect('/admin/users?success=Usuário excluído');
});

// Alterar senha do admin logado
router.post('/change-password', requireAuth, strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.changePassword);
}, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/admin/users?error=Todos os campos são obrigatórios');
  }

  if (new_password !== confirm_password) {
    return res.redirect('/admin/users?error=As senhas não conferem');
  }

  if (new_password.length < 6) {
    return res.redirect('/admin/users?error=A senha deve ter pelo menos 6 caracteres');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(req.session.userId).get();

  if (!user) {
    return res.redirect('/admin/users?error=Erro ao buscar usuário');
  }

  const valid = bcrypt.compareSync(current_password, user.password);
  if (!valid) {
    return res.redirect('/admin/users?error=Senha atual incorreta');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(hash, req.session.userId).run();

  res.redirect('/admin/users?success=Senha alterada com sucesso');
});

// Resetar senha de usuário para padrão
router.post('/:id/reset-password', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare('UPDATE users SET password = ?, password_changed = 0, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(hash, id).run();
  res.redirect('/admin/users?success=Senha+resetada+para+padrão');
});

router.post('/bulk-update-flags', requireAuth, (req, res, next) => {
  validateAndHandle(req, res, next, v.bulkUserFlags);
}, (req, res) => {
  const userIds = Array.isArray(req.body.user_ids)
    ? req.body.user_ids
    : req.body.user_ids
      ? [req.body.user_ids]
      : [];

  const sanitizedIds = userIds
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (sanitizedIds.length === 0) {
    return res.redirect('/admin/users?error=Selecione+ao+menos+um+usuário.');
  }

  const currentUsers = db.prepare(`
    SELECT id, is_admin, is_public, approval_status
    FROM users
    WHERE id IN (${sanitizedIds.map(() => '?').join(',')})
  `).all(...sanitizedIds);

  const currentUsersById = new Map(currentUsers.map((user) => [user.id, user]));
  const activeAdminsAfterUpdate = db.prepare('SELECT id, is_admin, is_public FROM users').all().map((user) => {
    const pendingUser = currentUsersById.get(user.id);
    if (!pendingUser) {
      return user;
    }

    return {
      id: user.id,
      is_admin: parseToggleValue(req.body[`is_admin_${user.id}`]),
      is_public: parseToggleValue(req.body[`is_public_${user.id}`])
    };
  }).filter((user) => user.is_admin === 1 && user.is_public === 1);

  if (activeAdminsAfterUpdate.length === 0) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  const updateStmt = db.prepare(`
    UPDATE users
    SET is_admin = ?, is_reviewer = ?, is_public = ?, approval_status = ?,
        approved_at = CASE
          WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now', '-3 hours')
          ELSE approved_at
        END,
        approved_by = CASE
          WHEN ? = 'approved' AND approved_by IS NULL THEN ?
          ELSE approved_by
        END,
        updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `);

  const updateMany = db.transaction((ids) => {
    ids.forEach((rawId) => {
      const id = parseInt(rawId, 10);
      if (!Number.isInteger(id)) return;
      const currentUser = currentUsersById.get(id);
      const nextIsPublic = parseToggleValue(req.body[`is_public_${id}`]);
      const approvalStatus = getNextApprovalStatus(currentUser && currentUser.approval_status, nextIsPublic);
      updateStmt.run(
        parseToggleValue(req.body[`is_admin_${id}`]),
        parseToggleValue(req.body[`is_reviewer_${id}`]),
        nextIsPublic,
        approvalStatus,
        approvalStatus,
        approvalStatus,
        req.session.userId,
        id
      );
    });
  });

  updateMany(sanitizedIds);
  return res.redirect('/admin/users?success=Perfis dos usuários atualizados');
});

router.post('/:id/approve', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id, name, email, approval_status FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  if (user.approval_status === 'approved') {
    return res.redirect('/admin/users?success=Cadastro já estava aprovado');
  }

  db.prepare(`
    UPDATE users
    SET is_public = 1,
        approval_status = 'approved',
        approved_at = datetime('now', '-3 hours'),
        approved_by = ?,
        password_changed = 0,
        profile_completed = 0,
        updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `).bind(req.session.userId, id).run();

  queueAccountApproved(user);

  return res.redirect('/admin/users?success=Cadastro aprovado com sucesso');
});

router.get('/import', requireAuth, (req, res) => {
  res.render('admin/users/import-users', {
    title: 'Importar Usuários',
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/import', requireAuth, strictLimiter, importUpload.single('import_file'), (req, res) => {
  if (!req.file || !req.file.path) {
    return res.redirect('/admin/users/import?error=' + encodeURIComponent('Selecione um arquivo XLSX, XLS ou CSV com a lista de participantes.'));
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  let rows;

  try {
    if (ext === '.csv') {
      const fileContent = fs.readFileSync(req.file.path, 'utf8').replace(/^\uFEFF/, '');
      const parsed = parseImportCsvContent(fileContent);
      if (parsed.headers.length < 1 || parsed.rows.length < 1) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.redirect('/admin/users/import?error=' + encodeURIComponent('O arquivo está vazio ou não possui dados.'));
      }
      rows = parsed.rows;
    } else {
      const workbook = xlsx.readFile(req.file.path, { type: 'buffer', cellDates: true });
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    }
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect('/admin/users/import?error=' + encodeURIComponent('Erro ao ler o arquivo. Certifique-se de que é uma planilha XLSX, XLS ou CSV válida.'));
  }

  if (!rows || !rows.length) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect('/admin/users/import?error=' + encodeURIComponent('O arquivo está vazio ou não possui dados.'));
  }

  const rawHeaders = Object.keys(rows[0]).map((h) => h.replace(/^\uFEFF/, ''));
  const normalize = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, '').replace(/\s+/g, '');
  const headers = rawHeaders.map(normalize);

  const findCol = (candidates) => {
    for (const c of candidates) { const exact = headers.find((h) => h === c); if (exact) return exact; }
    for (const c of candidates) { const contained = headers.find((h) => h.includes(c)); if (contained) return contained; }
    return undefined;
  };

  const colName = findCol(['nomecompleto', 'fullname', 'nomeparticipante', 'nome', 'participantname']);
  const colEmail = findCol(['email', 'mail', 'correoeletronico', 'emaildoparticipante']);
  const colInstitution = findCol(['instituicao', 'instituicaodoparticipante', 'organizacao', 'orgao', 'affiliation', 'instituicaodetrabalho']);
  const colPhone = findCol(['telefone', 'tel', 'phone', 'celular', 'whatsapp', 'numerodetelefone', 'telefonecelular']);
  const colCpf = findCol(['cpf']);
  const colPassport = findCol(['passaporte', 'passport']);

  const normalizedToRaw = {};
  headers.forEach((h, i) => { normalizedToRaw[h] = rawHeaders[i]; });
  const toRaw = (normalized) => normalized ? (normalizedToRaw[normalized] || normalized) : undefined;
  const rawName = toRaw(colName);
  const rawEmail = toRaw(colEmail);
  const rawInstitution = toRaw(colInstitution);
  const rawPhone = toRaw(colPhone);
  const rawCpf = toRaw(colCpf);
  const rawPassport = toRaw(colPassport);

  if (!rawEmail) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect('/admin/users/import?error=' + encodeURIComponent('Coluna de e-mail não encontrada. O arquivo precisa conter uma coluna com "email" ou "e-mail".'));
  }

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, institution, cpf, passport, phone, is_public, approval_status, approved_at, password_changed, profile_completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'approved', datetime('now','-3 hours'), 0, 0, datetime('now','-3 hours'), datetime('now','-3 hours'))
  `);
  const updateUser = db.prepare('UPDATE users SET name=COALESCE(?, name), institution=COALESCE(?, institution), phone=COALESCE(?, phone), email=COALESCE(?, email), cpf=COALESCE(?, cpf), passport=COALESCE(?, passport) WHERE id=?');
  const findUserByCpf = db.prepare("SELECT id, name, email, cpf FROM users WHERE cpf IS NOT NULL AND cpf != ''");
  const findUserByPassport = db.prepare("SELECT id, name, email, passport FROM users WHERE passport IS NOT NULL AND passport != ''");
  const findUserByEmail = db.prepare("SELECT id, name, email FROM users WHERE LOWER(TRIM(email)) = ?");

  const defaultPassword = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  let imported = 0;
  let skipped = 0;
  let updated = 0;
  const report = [];

  const dbTx = db.transaction(() => {
    for (const row of rows) {
      const cpf = rawCpf ? String(row[rawCpf] || '').trim() : '';
      const passport = rawPassport ? String(row[rawPassport] || '').trim() : '';
      const email = String(row[rawEmail] || '').trim().toLowerCase();
      const nameRaw = rawName ? String(row[rawName] || '').trim() : '';
      const institution = rawInstitution ? String(row[rawInstitution] || '').trim() : '';
      const phone = rawPhone ? String(row[rawPhone] || '').trim() : '';

      const personKey = nameRaw || (cpf ? cpf.replace(/[\.\-]/g, '') : email ? email.split('@')[0] : 'Sem nome');
      const personEmail = email && email !== '[object Object]' ? email : '(não informado)';

      const hasValidEmail = email && email !== '[object Object]' && email !== '' && email.includes('@');
      if (!hasValidEmail && !cpf && !passport) {
        if (!nameRaw && !institution && !phone && !cpf && !passport) {
          continue;
        }
        report.push({ name: personKey, email: personEmail, status: 'ignored', detail: 'Linha sem e-mail válido' });
        continue;
      }

      let existing = null;
      if (cpf && cpf.length >= 11) existing = findUserByCpf.get(cpf.replace(/\D/g, ''));
      if (!existing && passport) existing = findUserByPassport.get(passport.replace(/\s+/g, ''));
      if (!existing) existing = findUserByEmail.get(email);

      const nameToUse = nameRaw || (cpf ? cpf.replace(/[\.\-]/g, '') : email.split('@')[0] || 'Importado');

      if (existing) {
        const hasChanges = (nameRaw && nameRaw !== existing.name) || (institution && institution !== existing.institution) || (phone && phone !== existing.phone) || (email && email !== existing.email);
        if (hasChanges) {
          try {
            updateUser.run(nameRaw || null, institution || null, phone || null, email || null, cpf || null, passport || null, existing.id);
            updated += 1;
            report.push({ name: existing.name, email: personEmail, status: 'success', detail: 'Usuário existente — dados atualizados' });
          } catch (dbErr) {
            console.error('[users-import] DB update error for', email || cpf || passport, ':', dbErr.message);
            report.push({ name: existing.name, email: personEmail, status: 'error', detail: 'Erro ao atualizar: ' + dbErr.message });
          }
        } else {
          report.push({ name: existing.name, email: personEmail, status: 'success', detail: 'Usuário existente — sem alterações' });
        }
        skipped += 1;
      } else {
        try {
          const userId = insertUser.run(
            nameToUse, email || null, defaultPassword, institution || null,
            cpf || null, passport || null, phone || null
          ).lastInsertRowid;
          imported += 1;
          report.push({ name: nameToUse, email: personEmail, status: 'success', detail: 'Usuário criado' });
        } catch (dbErr) {
          console.error('[users-import] DB insert error for', email || cpf || passport, ':', dbErr.message);
          skipped += 1;
          report.push({ name: nameToUse, email: personEmail, status: 'error', detail: 'Erro ao criar: ' + dbErr.message });
        }
      }
    }
  });

  try {
    dbTx();
  } catch (dbErr) {
    console.error('[users-import] Transaction error:', dbErr.message);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect('/admin/users/import?error=' + encodeURIComponent('Erro ao salvar no banco de dados: ' + dbErr.message));
  }

  try { fs.unlinkSync(req.file.path); } catch (_) {}

  const errors = report.filter(r => r.status === 'error').length;
  const successes = report.filter(r => r.status === 'success').length;

  const batchId = createImportBatch({ batchType: 'users', importedBy: req.session.userId, report });
  req.session.importResult = {
    imported, skipped, updated, errors, successes, report, success: report.length > 0, batchId
  };
  return res.redirect('/admin/users/import/result');
});

router.get('/import/download-csv', requireAuth, (req, res) => {
  const data = req.session.importResult;
  if (!data || !data.report || !data.report.length) {
    return res.status(400).send('Nenhum relatório disponível.');
  }
  var lines = ['Nome;E-mail;Status;Detalhe'];
  data.report.forEach(function(r) {
    var esc = function(v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; };
    lines.push(esc(r.name) + ';' + esc(r.email) + ';' + r.status + ';' + esc(r.detail));
  });
  var csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-importacao-usuarios-' + new Date().toISOString().slice(0,10) + '.csv"');
  res.end(csv);
});

router.get('/import/result', requireAuth, (req, res) => {
  const data = req.session.importResult;
  if (!data) return res.redirect('/admin/users/import');
  res.render('admin/users/import-users-result', {
    title: 'Resultado da Importação',
    ...data,
    emailSummary: data.batchId ? getImportBatchEmailSummary(data.batchId) : null,
    systemEmailSettings: getSystemEmailSettings(),
    emailMessage: req.query.email_message || null,
    emailError: req.query.email_error || null
  });
});

router.post('/import/authorize-emails', requireAuth, strictLimiter, (req, res) => {
  const data = req.session.importResult;
  if (!data || !data.batchId) return res.redirect('/admin/users/import?error=' + encodeURIComponent('Nenhum lote disponível para autorização.'));
  try {
    const queued = authorizeImportBatch(data.batchId, req.session.userId);
    return res.redirect('/admin/users/import/result?email_message=' + encodeURIComponent(`${queued} e-mail(s) enfileirado(s).`));
  } catch (error) {
    return res.redirect('/admin/users/import/result?email_error=' + encodeURIComponent(error.message));
  }
});

router.get('/import-template', requireAuth, (req, res) => {
  const template = 'Nome completo;E-mail;Instituição;Telefone;CPF;Passaporte';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao.csv"');
  res.end('\uFEFF' + template);
});

module.exports = router;
