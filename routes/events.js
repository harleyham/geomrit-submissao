const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, recordParticipantAudit } = require('../db');
const { renderCertificatePdf } = require('../services/certificates');
const { strictLimiter } = require('../security/rate-limits');

const CERTIFICATE_ROLES = {
  participant: { label: 'Participante', title: 'CERTIFICADO DE PARTICIPAÇÃO', body: 'participou do evento {event}.', attendance: true },
  reviewer: { label: 'Revisor', title: 'CERTIFICADO DE REVISÃO', body: 'atuou como revisor(a) de trabalhos científicos no evento {event}.', attendance: false },
  speaker: { label: 'Palestrante', title: 'CERTIFICADO DE PALESTRANTE', body: 'participou como palestrante do evento {event}.', attendance: true },
  teacher: { label: 'Professor', title: 'CERTIFICADO DE PROFESSOR(A)', body: 'atuou como professor(a) no evento {event}.', attendance: true },
  oral_presenter: { label: 'Apresentador Oral', title: 'CERTIFICADO DE APRESENTAÇÃO ORAL', body: 'realizou apresentação oral no evento {event}.', attendance: true },
  poster_presenter: { label: 'Apresentador Pôster', title: 'CERTIFICADO DE APRESENTAÇÃO DE PÔSTER', body: 'realizou apresentação de pôster no evento {event}.', attendance: true }
};

function certificateRoleMeta(role) { return CERTIFICATE_ROLES[role] || CERTIFICATE_ROLES.participant; }
function certificateText(value, eventName) { return String(value || '').replaceAll('{event}', eventName); }

// Todas as rotas identificadas por evento exigem administração daquele evento.
router.use((req, res, next) => {
  const match = req.path.match(/^\/(\d+)(?:\/|$)/);
  if (!match) return next();
  const allowed = db.prepare("SELECT 1 FROM event_user_roles WHERE event_id=? AND user_id=? AND role='admin' LIMIT 1")
    .get(Number(match[1]), req.session.userId);
  if (!allowed) return res.status(403).render('error', { title: 'Acesso negado', message: 'Você não é administrador deste evento.' });
  next();
});

const certificateBackgroundDir = path.join(__dirname, '..', 'uploads', 'certificate-backgrounds');
if (!fs.existsSync(certificateBackgroundDir)) fs.mkdirSync(certificateBackgroundDir, { recursive: true });
const certificateBackgroundUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, certificateBackgroundDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype))
});

function parseAreaList(areaValue) {
  return String(areaValue || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAreaList(areaValue) {
  return Array.from(new Set(parseAreaList(areaValue))).join(', ');
}

function getKnownAreas() {
  const rows = db.prepare("SELECT area FROM events WHERE area IS NOT NULL AND area != ''").all();
  return Array.from(new Set(rows.flatMap((row) => parseAreaList(row.area)))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

function validateEventDates({
  date_start,
  date_end,
  registration_start,
  registration_end,
  has_article_submission,
  submission_start,
  submission_end,
  review_start,
  review_end,
  certificates_start,
  certificates_end
}) {
  if (date_start && date_end && date_end < date_start) {
    return 'A data final do evento não pode ser anterior à data inicial.';
  }

  if (registration_start && registration_end && registration_end < registration_start) {
    return 'A data final do período de inscrições não pode ser anterior à data inicial.';
  }

  if (has_article_submission) {
    if (submission_start && submission_end && submission_end < submission_start) {
      return 'A data final do período de submissão não pode ser anterior à data inicial.';
    }

    if (submission_end && review_start && review_start <= submission_end) {
      return 'O período de análise das submissões só pode começar após o fim do período de submissões.';
    }

    if (review_start && review_end && review_end < review_start) {
      return 'A data final do período de análise das submissões não pode ser anterior à data inicial.';
    }
  }

  if (certificates_start && certificates_end && certificates_end < certificates_start) {
    return 'A data final do período de certificados não pode ser anterior à data inicial.';
  }

  return null;
}

function renderEventForm(res, { event, title, error = null }) {
  return res.render('admin/events/form', {
    event,
    areas: getKnownAreas(),
    title,
    error
  });
}

function getAuthorRegistrationCountByEvent() {
  return db.prepare(`
    SELECT
      event_id,
      COUNT(DISTINCT CASE
        WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
        WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
        ELSE NULL
      END) as count
    FROM articles
    WHERE status != 'draft'
    GROUP BY event_id
  `).all();
}

function getListenerRegistrationCountByEvent() {
  return db.prepare(`
    SELECT event_id, COUNT(*) as count
    FROM event_registrations
    WHERE registration_type = 'listener'
    GROUP BY event_id
  `).all();
}

function getSubsidyRequestCountByEvent() {
  return db.prepare(`
    SELECT event_id, COUNT(*) as count
    FROM event_registrations
    WHERE subsidy_requested = 1
    GROUP BY event_id
  `).all();
}

function getEventParticipantSummary(eventId, filters = {}) {
  const params = [eventId];
  const conditions = ['er.event_id = ?'];

  if (filters.type && filters.type !== 'all') {
    conditions.push('er.registration_type = ?');
    params.push(filters.type);
  }

  if (filters.query) {
    conditions.push(`(
      LOWER(er.name) LIKE ?
      OR LOWER(er.email) LIKE ?
      OR LOWER(COALESCE(er.institution, '')) LIKE ?
    )`);
    const term = `%${String(filters.query).trim().toLowerCase()}%`;
    params.push(term, term, term);
  }

  return db.prepare(`
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
    ),
    submitted_articles AS (
      SELECT
        event_id,
        CASE
          WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
          WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
          ELSE NULL
        END as participant_key,
        COUNT(*) as submitted_count
      FROM articles
      WHERE status != 'draft'
      GROUP BY event_id, participant_key
    )
    SELECT
      er.*,
      u.name as linked_user_name,
      u.email as linked_user_email,
      u.is_reviewer as linked_user_is_reviewer,
      COALESCE(sa.submitted_count, 0) as submitted_articles,
      COALESCE(aa.approved_count, 0) as approved_articles,
      (SELECT COUNT(*) FROM participant_activity_enrollments pae WHERE pae.registration_id=er.id) AS enrolled_activities,
      (SELECT GROUP_CONCAT(ea.name, ' · ') FROM participant_activity_enrollments pae
        JOIN event_activities ea ON ea.id=pae.activity_id WHERE pae.registration_id=er.id) AS activity_names,
      CASE
        WHEN COALESCE(aa.approved_count, 0) > 0 THEN 'Apresentador com artigo aprovado'
        WHEN er.registration_type = 'author' THEN 'Participante com artigo submetido'
        ELSE 'Participante inscrito'
      END as participation_label
    FROM event_registrations er
    LEFT JOIN users u ON u.id = er.user_id
    LEFT JOIN approved_articles aa
      ON aa.event_id = er.event_id
     AND aa.participant_key = CASE
       WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
       ELSE 'email:' || LOWER(TRIM(er.email))
     END
    LEFT JOIN submitted_articles sa
      ON sa.event_id = er.event_id
     AND sa.participant_key = CASE
       WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
       ELSE 'email:' || LOWER(TRIM(er.email))
     END
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE
        WHEN COALESCE(aa.approved_count, 0) > 0 THEN 0
        WHEN er.registration_type = 'author' THEN 1
        ELSE 2
      END,
      er.name COLLATE NOCASE,
      er.created_at DESC
  `).bind(...params).all();
}

function getParticipantRegistrationForEvent(eventId, registrationId) {
  return db.prepare(`
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
    ),
    submitted_articles AS (
      SELECT
        event_id,
        CASE
          WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
          WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
          ELSE NULL
        END as participant_key,
        COUNT(*) as submitted_count
      FROM articles
      WHERE status != 'draft'
      GROUP BY event_id, participant_key
    )
    SELECT
      er.*,
      u.name as linked_user_name,
      u.email as linked_user_email,
      COALESCE(sa.submitted_count, 0) as submitted_articles,
      COALESCE(aa.approved_count, 0) as approved_articles
    FROM event_registrations er
    LEFT JOIN users u ON u.id = er.user_id
    LEFT JOIN approved_articles aa
      ON aa.event_id = er.event_id
     AND aa.participant_key = CASE
       WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
       ELSE 'email:' || LOWER(TRIM(er.email))
     END
    LEFT JOIN submitted_articles sa
      ON sa.event_id = er.event_id
     AND sa.participant_key = CASE
       WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
       ELSE 'email:' || LOWER(TRIM(er.email))
     END
    WHERE er.event_id = ?
      AND er.id = ?
  `).bind(eventId, registrationId).get();
}

// Listar eventos
router.get('/', (req, res) => {
  const authorRegistrationByEventId = new Map(getAuthorRegistrationCountByEvent().map((row) => [row.event_id, row.count]));
  const listenerRegistrationByEventId = new Map(getListenerRegistrationCountByEvent().map((row) => [row.event_id, row.count]));
  const subsidyRequestByEventId = new Map(getSubsidyRequestCountByEvent().map((row) => [row.event_id, row.count]));
  const events = db.prepare(`SELECT e.* FROM events e JOIN event_user_roles eur ON eur.event_id=e.id
    WHERE eur.user_id=? AND eur.role='admin' ORDER BY e.date_start DESC`).all(req.session.userId).map((event) => ({
    ...withAreaMeta(event),
    author_registered_count: authorRegistrationByEventId.get(event.id) || 0,
    listener_registered_count: listenerRegistrationByEventId.get(event.id) || 0,
    subsidy_request_count: subsidyRequestByEventId.get(event.id) || 0,
    registered_count: (authorRegistrationByEventId.get(event.id) || 0) + (listenerRegistrationByEventId.get(event.id) || 0)
  }));
  res.render('admin/events/list', { events, title: 'Eventos' });
});

// Novo evento
router.get('/new', (req, res) => {
  renderEventForm(res, { event: null, title: 'Novo Evento' });
});

// Criar evento
router.post('/', strictLimiter, (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, offers_subsidy, has_article_submission } = req.body;
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const hasArticleSubmission = has_article_submission ? 1 : 0;
  const normalizedSubmissionStart = hasArticleSubmission ? (submission_start || null) : null;
  const normalizedSubmissionEnd = hasArticleSubmission ? (submission_end || null) : null;
  const normalizedReviewStart = hasArticleSubmission ? (review_start || null) : null;
  const normalizedReviewEnd = hasArticleSubmission ? (review_end || null) : null;
  const validationError = validateEventDates({
    date_start,
    date_end,
    registration_start,
    registration_end,
    has_article_submission: hasArticleSubmission,
    submission_start: normalizedSubmissionStart,
    submission_end: normalizedSubmissionEnd,
    review_start: normalizedReviewStart,
    review_end: normalizedReviewEnd,
    certificates_start,
    certificates_end
  });

  if (validationError) {
    return renderEventForm(res, {
      event: withAreaMeta({
        name,
        short_name,
        description,
        date_start,
        date_end,
        location,
        url,
        area: normalizedArea,
        has_article_submission: hasArticleSubmission,
        offers_subsidy: offersSubsidy,
        status: status || 'draft',
        institution,
        language,
        registration_start,
        registration_end,
        submission_start: normalizedSubmissionStart,
        submission_end: normalizedSubmissionEnd,
        review_start: normalizedReviewStart,
        review_end: normalizedReviewEnd,
        certificates_start,
        certificates_end
      }),
      title: 'Novo Evento',
      error: validationError
    });
  }

  const createdEvent = db.prepare(`
    INSERT INTO events (name, short_name, description, date_start, date_end, location, url, area, has_article_submission, offers_subsidy, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, status || 'draft', institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd, normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null).run();
  db.prepare("INSERT OR IGNORE INTO event_user_roles (event_id,user_id,role,assigned_by) VALUES (? ,? ,'admin',?)").run(createdEvent.lastInsertRowid, req.session.userId, req.session.userId);
  res.redirect('/admin/events');
});

// Editar evento
router.get('/:id/edit', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não foi encontrado.' });
  renderEventForm(res, { event, title: 'Editar Evento' });
});

// Atualizar evento (POST direto)
router.post('/:id', strictLimiter, (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, offers_subsidy, has_article_submission } = req.body;
  const normalizedStatus = status || 'draft';
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const hasArticleSubmission = has_article_submission ? 1 : 0;
  const normalizedSubmissionStart = hasArticleSubmission ? (submission_start || null) : null;
  const normalizedSubmissionEnd = hasArticleSubmission ? (submission_end || null) : null;
  const normalizedReviewStart = hasArticleSubmission ? (review_start || null) : null;
  const normalizedReviewEnd = hasArticleSubmission ? (review_end || null) : null;
  const validationError = validateEventDates({
    date_start,
    date_end,
    registration_start,
    registration_end,
    has_article_submission: hasArticleSubmission,
    submission_start: normalizedSubmissionStart,
    submission_end: normalizedSubmissionEnd,
    review_start: normalizedReviewStart,
    review_end: normalizedReviewEnd,
    certificates_start,
    certificates_end
  });

  if (validationError) {
    return renderEventForm(res, {
      event: withAreaMeta({
        id: req.params.id,
        name,
        short_name,
        description,
        date_start,
        date_end,
        location,
        url,
        area: normalizedArea,
        has_article_submission: hasArticleSubmission,
        offers_subsidy: offersSubsidy,
        status: status || 'draft',
        institution,
        language,
        registration_start,
        registration_end,
        submission_start: normalizedSubmissionStart,
        submission_end: normalizedSubmissionEnd,
        review_start: normalizedReviewStart,
        review_end: normalizedReviewEnd,
        certificates_start,
        certificates_end
      }),
      title: 'Editar Evento',
      error: validationError
    });
  }

  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, has_article_submission=?, offers_subsidy=?, status=?, institution=?, language=?, registration_start=?, registration_end=?, submission_start=?, submission_end=?, review_start=?, review_end=?, certificates_start=?, certificates_end=?, updated_at=datetime('now', '-3 hours')
    WHERE id=?
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, normalizedStatus, institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd, normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null, req.params.id).run();
  res.redirect('/admin/events');
});

// Deletar evento
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').bind(req.params.id).run();
  res.redirect('/admin/events');
});

router.get('/:id/subsidies', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const subsidyRequests = db.prepare(`
    SELECT
      er.*,
      u.name as reviewed_by_name
    FROM event_registrations er
    LEFT JOIN users u ON u.id = er.subsidy_reviewed_by
    WHERE er.event_id = ?
      AND er.subsidy_requested = 1
    ORDER BY
      CASE er.subsidy_status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        WHEN 'rejected' THEN 2
        ELSE 3
      END,
      er.created_at DESC
  `).bind(req.params.id).all();

  const summary = subsidyRequests.reduce((acc, request) => {
    acc.total += 1;
    if (request.subsidy_status === 'approved') acc.approved += 1;
    else if (request.subsidy_status === 'rejected') acc.rejected += 1;
    else acc.pending += 1;
    return acc;
  }, { total: 0, pending: 0, approved: 0, rejected: 0 });

  res.render('admin/events/subsidies', {
    title: `Pedidos de Subsídio - ${event.name}`,
    event,
    subsidyRequests,
    summary
  });
});

router.get('/:id/participants', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const filters = {
    query: String(req.query.q || '').trim(),
    type: ['all', 'listener', 'author'].includes(String(req.query.type || 'all')) ? String(req.query.type || 'all') : 'all'
  };

  const participants = getEventParticipantSummary(req.params.id, filters);
  const summary = participants.reduce((acc, participant) => {
    acc.total += 1;
    if (participant.registration_type === 'author') acc.authors += 1;
    else acc.listeners += 1;
    if (participant.approved_articles > 0) acc.approvedPresenters += 1;
    if (participant.subsidy_requested) acc.subsidyRequests += 1;
    return acc;
  }, {
    total: 0,
    authors: 0,
    listeners: 0,
    approvedPresenters: 0,
    subsidyRequests: 0
  });

  res.render('admin/events/participants', {
    title: `Participantes - ${event.name}`,
    event,
    participants,
    filters,
    summary,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/:id/attendance', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const filters = {
    query: String(req.query.q || '').trim(),
    status: ['all', 'present', 'absent'].includes(String(req.query.status || 'all')) ? String(req.query.status || 'all') : 'all'
  };
  const allParticipants = db.prepare(`
    WITH people AS (
      SELECT er.user_id, er.id AS registration_id, er.name, er.email, er.institution,
        CASE WHEN er.registration_type='author' THEN 'Participante com artigo' ELSE 'Participante' END AS role_label
      FROM event_registrations er WHERE er.event_id=? AND er.user_id IS NOT NULL
      UNION ALL
      SELECT u.id, NULL, u.name, u.email, u.institution, 'Revisor'
      FROM assignments ass JOIN articles art ON art.id=ass.article_id JOIN users u ON u.id=ass.reviewer_id
      WHERE art.event_id=?
      UNION ALL
      SELECT u.id, NULL, u.name, u.email, u.institution,
        CASE eur.role WHEN 'speaker' THEN 'Palestrante' WHEN 'teacher' THEN 'Professor' WHEN 'oral_presenter' THEN 'Apresentador Oral' WHEN 'poster_presenter' THEN 'Apresentador Pôster' END
      FROM event_user_roles eur JOIN users u ON u.id=eur.user_id WHERE eur.event_id=?
    ), grouped AS (
      SELECT user_id, MAX(registration_id) AS registration_id, MAX(name) AS name, MAX(email) AS email,
        MAX(institution) AS institution, GROUP_CONCAT(DISTINCT role_label) AS roles
      FROM people GROUP BY user_id
    )
    SELECT grouped.*, ar.id AS attendance_id, ar.attended_at, ar.notes, marker.name AS marked_by_name,
      CASE WHEN ar.id IS NULL THEN 0 ELSE 1 END AS attendance_total
    FROM grouped LEFT JOIN attendance_records ar ON ar.event_id=? AND ar.user_id=grouped.user_id
    LEFT JOIN users marker ON marker.id=ar.marked_by ORDER BY grouped.name COLLATE NOCASE
  `).all(event.id, event.id, event.id, event.id);

  let participants = allParticipants.filter((participant) => {
    if (!filters.query) return true;
    const term = filters.query.toLowerCase();
    return [participant.name, participant.email, participant.institution, participant.roles].some((value) => String(value || '').toLowerCase().includes(term));
  });
  if (filters.status === 'present') participants = participants.filter((participant) => participant.attendance_total === 1);
  if (filters.status === 'absent') participants = participants.filter((participant) => participant.attendance_total === 0);

  const totals = { registered: allParticipants.length, present: allParticipants.filter((participant) => participant.attendance_total === 1).length };
  const activities = db.prepare('SELECT id,name,activity_type,activity_date,workload_hours,eligible_roles FROM event_activities WHERE event_id=? ORDER BY activity_date,name').all(event.id);

  res.render('admin/events/attendance', {
    title: `Presença - ${event.name}`,
    event,
    participants,
    activities,
    filters,
    summary: {
      registered: totals.registered || 0,
      present: totals.present || 0,
      absent: Math.max(0, (totals.registered || 0) - (totals.present || 0))
    },
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/:id/attendance/:userId', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const person = db.prepare(`SELECT u.id AS user_id, u.name, u.email,
    (SELECT id FROM event_registrations WHERE event_id=? AND user_id=u.id LIMIT 1) AS registration_id
    FROM users u WHERE u.id=?`).get(event.id, req.params.userId);
  if (!person) return res.status(404).render('error', { title: 'Pessoa não encontrada' });

  const action = req.body.action === 'mark_absent' ? 'mark_absent' : 'mark_present';
  const notes = String(req.body.notes || '').trim();
  if (action === 'mark_absent') {
    const removed = db.prepare(`
      DELETE FROM attendance_records WHERE event_id = ? AND user_id = ?
    `).run(event.id, person.user_id);
    if (removed.changes) {
      recordParticipantAudit({
        eventId: event.id,
        registrationId: person.registration_id || null,
        actorUserId: req.session.userId,
        action: 'attendance_removed',
        details: { participant_name: person.name, participant_email: person.email }
      });
    }
    return res.redirect(`/admin/events/${event.id}/attendance?success=${encodeURIComponent('Presença removida; participante marcado como ausente.')}`);
  }

  const existingAttendance = db.prepare('SELECT id FROM attendance_records WHERE event_id=? AND user_id=?').get(event.id, person.user_id);
  if (existingAttendance) {
    db.prepare("UPDATE attendance_records SET marked_by=?, attended_at=datetime('now','-3 hours'), notes=?, updated_at=datetime('now','-3 hours') WHERE id=?").run(req.session.userId, notes, existingAttendance.id);
  } else {
    db.prepare("INSERT INTO attendance_records (event_id,registration_id,user_id,marked_by,attended_at,notes,created_at,updated_at) VALUES (?,?,?,?,datetime('now','-3 hours'),?,datetime('now','-3 hours'),datetime('now','-3 hours'))")
      .run(event.id, person.registration_id || null, person.user_id, req.session.userId, notes);
  }
  recordParticipantAudit({
    eventId: event.id,
    registrationId: person.registration_id || null,
    actorUserId: req.session.userId,
    action: 'attendance_marked_present',
    details: { participant_name: person.name, participant_email: person.email, notes }
  });
  return res.redirect(`/admin/events/${event.id}/attendance?success=${encodeURIComponent('Presença registrada com sucesso.')}`);
});

function getRoleActivityAttendance(eventId, userId, role) {
  const activities = db.prepare(`
    SELECT ea.id AS activity_id, ea.name AS activity_name, ea.activity_type,
      ea.activity_date, COALESCE(ea.workload_hours, 0) AS workload_hours
    FROM activity_attendance_records aar
    JOIN event_activities ea ON ea.id = aar.activity_id
    WHERE ea.event_id = ? AND aar.user_id = ? AND aar.role = ?
      AND ea.certificate_enabled = 1
      AND (? <> 'participant' OR EXISTS (
        SELECT 1
        FROM participant_activity_enrollments pae
        WHERE pae.activity_id = aar.activity_id AND pae.user_id = aar.user_id
      ))
    ORDER BY ea.activity_date, ea.name
  `).all(eventId, userId, role, role);
  return {
    attended_activities: activities,
    activities_attended: activities.length,
    attendance_count: activities.length,
    total_workload_hours: activities.reduce((sum, activity) => sum + (Number(activity.workload_hours) || 0), 0)
  };
}

function getCertificateRule(eventId, role) {
  const meta = certificateRoleMeta(role);
  const rule = db.prepare('SELECT * FROM event_certificate_rules WHERE event_id = ? AND certificate_role = ?').get(eventId, role);
  return rule || { certificate_role: role, min_attendance: 1, background_id: null, text_color: '#0f172a', title: meta.title, body_text: meta.body };
}

function enrichCertificateCandidate(eventId, role, candidate) {
  const emission = db.prepare(`SELECT id, version FROM certificate_emissions
    WHERE event_id=? AND user_id=? AND certificate_role=? AND status='issued' ORDER BY version DESC LIMIT 1`).get(eventId, candidate.user_id, role);
  const latest = db.prepare(`SELECT MAX(version) AS version FROM certificate_emissions
    WHERE event_id=? AND user_id=? AND certificate_role=?`).get(eventId, candidate.user_id, role);
  return { ...candidate, role, role_label: certificateRoleMeta(role).label, active_emission_id: emission && emission.id, latest_version: latest && latest.version || 0 };
}

function getCertificateCandidates(eventId, role, rule) {
  const minAttendance = role === 'reviewer' ? 0 : Math.max(1, Number(rule.min_attendance) || 1);
  if (role === 'participant') {
    return db.prepare(`SELECT er.id AS registration_id, er.user_id, er.name, er.email, er.registration_type
      FROM event_registrations er WHERE er.event_id=? AND er.user_id IS NOT NULL
      ORDER BY er.name COLLATE NOCASE`).all(eventId).map((item) => {
        const attendance = getRoleActivityAttendance(eventId, item.user_id, role);
        return enrichCertificateCandidate(eventId, role, {
          ...item, ...attendance, text_color: rule.text_color,
          eligible: attendance.attendance_count >= minAttendance
        });
      });
  }
  if (role === 'reviewer') {
    return db.prepare(`WITH reviewers AS (
        SELECT a.reviewer_id AS user_id FROM assignments a JOIN articles ar ON ar.id=a.article_id WHERE ar.event_id=?
        UNION SELECT user_id FROM event_user_roles WHERE event_id=? AND role='reviewer'
      ) SELECT u.id AS user_id, u.name, u.email,
        (SELECT er.id FROM event_registrations er WHERE er.event_id=? AND er.user_id=u.id LIMIT 1) AS registration_id,
        (SELECT COUNT(*) FROM reports r JOIN assignments a ON a.id=r.assignment_id
          JOIN articles ar ON ar.id=a.article_id WHERE ar.event_id=? AND a.reviewer_id=u.id) AS report_count
      FROM reviewers rv JOIN users u ON u.id=rv.user_id ORDER BY u.name COLLATE NOCASE
    `).all(eventId, eventId, eventId, eventId).map((item) => {
      const attendance = getRoleActivityAttendance(eventId, item.user_id, role);
      return enrichCertificateCandidate(eventId, role, {
        ...item, ...attendance, text_color: rule.text_color,
        eligible: item.report_count > 0
      });
    });
  }
  return db.prepare(`SELECT eur.user_id, u.name, u.email, eur.article_id, ar.title AS article_title, NULL AS registration_id
    FROM event_user_roles eur JOIN users u ON u.id=eur.user_id
    LEFT JOIN articles ar ON ar.id=eur.article_id
    WHERE eur.event_id=? AND eur.role=? ORDER BY u.name COLLATE NOCASE`).all(eventId, role)
    .map((item) => {
      const attendance = getRoleActivityAttendance(eventId, item.user_id, role);
      const registration = db.prepare('SELECT id FROM event_registrations WHERE event_id=? AND user_id=?').get(eventId, item.user_id);
      return enrichCertificateCandidate(eventId, role, {
        ...item, ...attendance, registration_id: registration ? registration.id : null,
        text_color: rule.text_color, eligible: attendance.attendance_count >= minAttendance
      });
    });
}

router.get('/:id/certificates', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const rules = Object.keys(CERTIFICATE_ROLES).map((role) => getCertificateRule(event.id, role));
  const certificatesByRole = rules.map((rule) => ({
    ...rule,
    role: rule.certificate_role,
    meta: certificateRoleMeta(rule.certificate_role),
    candidates: getCertificateCandidates(event.id, rule.certificate_role, rule)
  }));
  const backgrounds = db.prepare('SELECT * FROM certificate_backgrounds ORDER BY created_at DESC').all();
  res.render('admin/events/certificates', {
    title: `Certificados - ${event.name}`,
    event,
    rules,
    certificatesByRole,
    backgrounds,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/:id/certificates/backgrounds/:backgroundId/view', (req, res) => {
  const bg = db.prepare('SELECT * FROM certificate_backgrounds WHERE id = ?').get(req.params.backgroundId);
  if (!bg) return res.status(404).render('error', { title: 'Fundo não encontrado' });
  const filePath = bg.file_path.startsWith('certificate-backgrounds/')
    ? path.join(__dirname, '..', 'uploads', bg.file_path)
    : path.join(__dirname, '..', bg.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).render('error', { title: 'Arquivo do fundo não encontrado' });
  res.type(bg.mime_type);
  res.sendFile(filePath);
});

router.get('/:id/certificates/preview', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não foi encontrado.' });
  const role = CERTIFICATE_ROLES[req.query.role] ? req.query.role : 'participant';
  const rule = getCertificateRule(event.id, role);

  const selectedBackgroundId = req.query.background_id;
  const selectedTextColor = req.query.text_color;

  const backgroundId = selectedBackgroundId || rule.background_id;
  // A cor persistida na regra é a fonte de verdade. O parâmetro é aceito
  // apenas quando chega como hexadecimal válido (o caractere # em URLs não
  // codificadas é tratado pelo navegador como fragmento).
  const textColor = /^#[0-9a-fA-F]{6}$/.test(String(selectedTextColor || ''))
    ? selectedTextColor
    : (rule.text_color || '#0f172a');

  if (!backgroundId) {
    return res.status(400).render('error', { title: 'Prévia indisponível', message: 'Selecione e salve um fundo para este tipo de certificado antes de abrir a prévia.' });
  }

  const background = db.prepare('SELECT * FROM certificate_backgrounds WHERE id = ?').get(backgroundId);
  if (!background) {
    return res.status(400).render('error', { title: 'Prévia indisponível', message: 'O fundo de certificado selecionado não foi encontrado.' });
  }

  const preview = {
    participant_name: 'Nome da Pessoa Certificada',
    event_name: event.name,
    event_date_start: event.date_start || 'DD/MM/YYYY',
    event_date_end: event.date_end || 'DD/MM/YYYY',
    certificate_code: 'PREVIEW-CODE',
    issued_at: new Date(Date.now() - 3 * 3600000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
    text_color: textColor,
    certificate_title: certificateText(rule.title || certificateRoleMeta(role).title, event.name),
    certificate_body: certificateText(rule.body_text || certificateRoleMeta(role).body, event.name),
    background_path: background.file_path,
    activities_attended: 0,
    total_workload_hours: 0
  };
  res.type('application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  renderCertificatePdf(res, preview);
});

router.get('/:id/activities', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const activities = db.prepare(`
    SELECT ea.*,
      (SELECT COUNT(*) FROM participant_activity_enrollments pae WHERE pae.activity_id=ea.id) AS enrolled_count,
      (SELECT COUNT(*) FROM activity_attendance_records aar WHERE aar.activity_id=ea.id) AS attendees_count
    FROM event_activities ea
    WHERE ea.event_id = ?
    ORDER BY ea.activity_date, ea.name
  `).bind(req.params.id).all();
  const editingActivity = req.query.edit_activity_id
    ? activities.find((activity) => Number(activity.id) === Number(req.query.edit_activity_id)) || null
    : null;
  res.render('admin/events/activities', {
    title: `Atividades - ${event.name}`,
    event, activities, editingActivity,
    success: req.query.success || null,
    error: req.query.error || null
  });
});
router.post('/:id/activities', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const name = String(req.body.name || '').trim();
  const validRoles = Object.keys(CERTIFICATE_ROLES);
  const submittedRoles = Array.isArray(req.body.eligible_roles) ? req.body.eligible_roles : [req.body.eligible_roles];
  const eligibleRoles = [...new Set(submittedRoles.filter((role) => validRoles.includes(role)))];
  if (!name || eligibleRoles.length === 0) {
    return res.redirect(`/admin/events/${event.id}/activities?error=${encodeURIComponent('Informe o nome e ao menos um papel elegível para a atividade.')}`);
  }
  const validTypes = ['lecture', 'seminar', 'roundtable', 'course', 'oral_presentation', 'poster_presentation', 'other'];
  const activityType = validTypes.includes(req.body.activity_type) ? req.body.activity_type : 'other';
  const workloadHours = Math.max(0, Number(req.body.workload_hours) || 0);
  const certificateEnabled = req.body.certificate_enabled === '1' ? 1 : 0;
  db.prepare(`INSERT INTO event_activities
    (event_id,name,activity_type,activity_date,workload_hours,certificate_enabled,eligible_roles,certificate_role)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    event.id, name, activityType, req.body.activity_date || null, workloadHours,
    certificateEnabled, eligibleRoles.join(','), eligibleRoles[0]
  );
  return res.redirect(`/admin/events/${event.id}/activities?success=${encodeURIComponent('Atividade cadastrada.')}`);
});
router.post('/:id/activities/:activityId', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT * FROM event_activities WHERE id=? AND event_id=?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const name = String(req.body.name || '').trim();
  const validRoles = Object.keys(CERTIFICATE_ROLES);
  const submittedRoles = Array.isArray(req.body.eligible_roles) ? req.body.eligible_roles : [req.body.eligible_roles];
  const eligibleRoles = [...new Set(submittedRoles.filter((role) => validRoles.includes(role)))];
  if (!name || eligibleRoles.length === 0) {
    return res.redirect(`/admin/events/${activity.event_id}/activities?edit_activity_id=${activity.id}&error=${encodeURIComponent('Informe o nome e ao menos um papel elegível.')}`);
  }
  const enrolledCount = db.prepare('SELECT COUNT(*) AS count FROM participant_activity_enrollments WHERE activity_id=?').get(activity.id).count;
  if (enrolledCount > 0 && !eligibleRoles.includes('participant')) {
    return res.redirect(`/admin/events/${activity.event_id}/activities?edit_activity_id=${activity.id}&error=${encodeURIComponent('Não é possível retirar o papel Participante enquanto houver pessoas inscritas nesta atividade.')}`);
  }
  const validTypes = ['lecture', 'seminar', 'roundtable', 'course', 'oral_presentation', 'poster_presentation', 'other'];
  const activityType = validTypes.includes(req.body.activity_type) ? req.body.activity_type : 'other';
  const workloadHours = Math.max(0, Number(req.body.workload_hours) || 0);
  const certificateEnabled = req.body.certificate_enabled === '1' ? 1 : 0;
  db.prepare(`UPDATE event_activities SET name=?,activity_type=?,activity_date=?,workload_hours=?,
    certificate_enabled=?,eligible_roles=?,certificate_role=? WHERE id=?`).run(
    name, activityType, req.body.activity_date || null, workloadHours, certificateEnabled,
    eligibleRoles.join(','), eligibleRoles[0], activity.id
  );
  return res.redirect(`/admin/events/${activity.event_id}/activities?success=${encodeURIComponent('Atividade atualizada.')}`);
});
router.post('/:id/activities/:activityId/certificate-enabled', (req, res) => {
  const activity = db.prepare('SELECT id,event_id FROM event_activities WHERE id=? AND event_id=?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const enabled = req.body.enabled === '1' ? 1 : 0;
  db.prepare('UPDATE event_activities SET certificate_enabled=? WHERE id=?').run(enabled, activity.id);
  return res.redirect(`/admin/events/${activity.event_id}/activities?success=${encodeURIComponent(enabled ? 'Atividade incluída no cálculo dos certificados.' : 'Atividade retirada do cálculo dos certificados.')}`);
});
router.get('/:id/activities/:activityId/attendance', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const activity = db.prepare('SELECT a.*, e.name AS event_name FROM event_activities a JOIN events e ON e.id = a.event_id WHERE a.id = ? AND a.event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const allowedRoles = String(activity.eligible_roles || 'participant').split(',').map((role) => role.trim());
  const people = db.prepare(`WITH event_people AS (
      SELECT er.user_id AS person_user_id, er.name, er.email, er.institution, er.id AS registration_id, 'participant' AS role
        FROM event_registrations er JOIN participant_activity_enrollments pae ON pae.registration_id=er.id AND pae.activity_id=?
        WHERE er.event_id=? AND er.user_id IS NOT NULL
      UNION ALL SELECT eur.user_id, u.name, u.email, u.institution, NULL, eur.role FROM event_user_roles eur JOIN users u ON u.id=eur.user_id WHERE eur.event_id=?
      UNION ALL SELECT DISTINCT ass.reviewer_id, u.name, u.email, u.institution, NULL, 'reviewer'
        FROM assignments ass JOIN articles ar ON ar.id=ass.article_id JOIN users u ON u.id=ass.reviewer_id WHERE ar.event_id=?
    ) SELECT ep.person_user_id AS user_id, MAX(ep.name) AS name, MAX(ep.email) AS email, MAX(ep.institution) AS institution, MAX(ep.registration_id) AS registration_id, GROUP_CONCAT(DISTINCT ep.role) AS roles,
      CASE WHEN aar.id IS NULL THEN 0 ELSE 1 END AS present,
      COALESCE(aar.role, '') AS activity_role
    FROM event_people ep
    LEFT JOIN activity_attendance_records aar ON aar.activity_id=? AND aar.user_id=ep.person_user_id
    GROUP BY ep.person_user_id ORDER BY name COLLATE NOCASE`).all(activity.id, activity.event_id, activity.event_id, activity.event_id, activity.id)
    .filter((person) => String(person.roles).split(',').some((role) => allowedRoles.includes(role)));
  const roleLabels = Object.fromEntries(Object.entries(CERTIFICATE_ROLES).map(([role, meta]) => [role, meta.label]));
  people.forEach((person) => {
    const assignedRoles = String(person.roles || '').split(',').map((role) => role.trim()).filter(Boolean);
    person.available_activity_roles = allowedRoles.filter((role) => assignedRoles.includes(role));
  });
  res.render('admin/events/activity-attendance', {
    title: `Presença - ${activity.name}`, event, activity, participants: people,
    roleLabels,
    success: req.query.success || null,
    error: req.query.error || null
  });
});
router.post('/:id/activities/:activityId/attendance/:userId', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT id, event_id, eligible_roles FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const userId = Number(req.params.userId);
  const role = String(req.body.role || '').trim();

  if (req.body.action === 'absent' || !role) {
    const existing = db.prepare('SELECT registration_id,role FROM activity_attendance_records WHERE activity_id=? AND user_id=?').get(activity.id, userId);
    const removed = db.prepare('DELETE FROM activity_attendance_records WHERE activity_id=? AND user_id=?').run(activity.id, userId);
    if (removed.changes) recordParticipantAudit({
      eventId: activity.event_id, registrationId: existing && existing.registration_id,
      actorUserId: req.session.userId, action: 'activity_attendance_removed',
      details: { activity_id: activity.id, user_id: userId, role: existing && existing.role }
    });
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance`);
  }

  const registration = db.prepare('SELECT id FROM event_registrations WHERE event_id=? AND user_id=?').get(activity.event_id, userId);
  const participantEnrollment = registration && role === 'participant' && db.prepare(`SELECT 1 FROM participant_activity_enrollments
    WHERE activity_id=? AND registration_id=? AND user_id=?`).get(activity.id, registration.id, userId);
  const eventRole = db.prepare('SELECT 1 FROM event_user_roles WHERE event_id=? AND user_id=? AND role=?').get(activity.event_id, userId, role);
  const reviewerAssignment = role === 'reviewer' && db.prepare(`SELECT 1 FROM assignments ass
    JOIN articles ar ON ar.id=ass.article_id WHERE ar.event_id=? AND ass.reviewer_id=? LIMIT 1`).get(activity.event_id, userId);
  const allowedRoles = String(activity.eligible_roles || '').split(',').map((item) => item.trim()).filter(Boolean);
  const hasRoleInEvent = role === 'participant' ? Boolean(participantEnrollment) : Boolean(eventRole || reviewerAssignment);
  if (!CERTIFICATE_ROLES[role] || !allowedRoles.includes(role) || !hasRoleInEvent) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance?error=${encodeURIComponent('A pessoa não possui este papel no evento ou o papel não é elegível para a atividade.')}`);
  }

  const existing = db.prepare('SELECT id FROM activity_attendance_records WHERE activity_id=? AND user_id=?').get(activity.id, userId);
  if (existing) {
    db.prepare("UPDATE activity_attendance_records SET role=?,registration_id=?,marked_by=?,attended_at=datetime('now','-3 hours') WHERE id=?")
      .run(role, registration ? registration.id : null, req.session.userId, existing.id);
  } else {
    db.prepare('INSERT INTO activity_attendance_records(activity_id,registration_id,user_id,role,marked_by) VALUES(?,?,?,?,?)')
      .run(activity.id, registration ? registration.id : null, userId, role, req.session.userId);
  }
  recordParticipantAudit({
    eventId: activity.event_id, registrationId: registration ? registration.id : null,
    actorUserId: req.session.userId, action: 'activity_attendance_marked',
    details: { activity_id: activity.id, user_id: userId, role }
  });

  res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance`);
});

router.post('/:id/activities/:activityId/certificate-rule', (req, res) => {
  return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent('As regras de certificado agora são configuradas por papel no evento.')}`);
});

router.post('/:id/certificates/rule', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const role = CERTIFICATE_ROLES[req.body.certificate_role] ? req.body.certificate_role : 'participant';
  const minAttendance = role === 'reviewer' ? 0 : Math.max(1, parseInt(req.body.min_attendance, 10) || 1);
  const backgroundId = req.body.background_id ? parseInt(req.body.background_id, 10) : null;
  const textColor = String(req.body.text_color || '#0f172a').trim();
  const normalizedTextColor = /^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#0f172a';
  if (!backgroundId || !db.prepare('SELECT id FROM certificate_backgrounds WHERE id = ?').get(backgroundId)) {
    return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent('Selecione um fundo de certificado válido.')}`);
  }
  const meta = certificateRoleMeta(role);
  const title = String(req.body.title || meta.title).trim().slice(0, 160);
  const bodyText = String(req.body.body_text || meta.body).trim().slice(0, 500);
  db.prepare(`INSERT INTO event_certificate_rules (event_id,certificate_role,min_attendance,background_id,text_color,title,body_text,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))
    ON CONFLICT(event_id,certificate_role) DO UPDATE SET min_attendance=excluded.min_attendance,background_id=excluded.background_id,text_color=excluded.text_color,title=excluded.title,body_text=excluded.body_text,updated_by=excluded.updated_by,updated_at=datetime('now','-3 hours')
  `).run(event.id, role, minAttendance, backgroundId, normalizedTextColor, title, bodyText, req.session.userId);
  res.redirect(`/admin/events/${event.id}/certificates?success=${encodeURIComponent('Regra de elegibilidade salva.')}`);
});

router.post('/:id/certificates/backgrounds', strictLimiter, (req, res) => {
  certificateBackgroundUpload.single('background_file')(req, res, (error) => {
    if (error || !req.file || !String(req.body.name || '').trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
      const message = error && error.code === 'LIMIT_FILE_SIZE' ? 'O fundo excede 10 MB.' : 'Informe um nome e envie uma imagem PNG ou JPEG.';
      return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent(message)}`);
    }
    db.prepare(`INSERT INTO certificate_backgrounds (name,file_path,original_name,mime_type,created_by,created_at) VALUES (?,?,?,?,?,datetime('now','-3 hours'))`)
      .run(String(req.body.name).trim(), `uploads/certificate-backgrounds/${req.file.filename}`, req.file.originalname, req.file.mimetype, req.session.userId);
    return res.redirect(`/admin/events/${req.params.id}/certificates?success=${encodeURIComponent('Fundo enviado para a biblioteca.')}`);
  });
});

function issueCertificate(event, role, userId, actorUserId, reissuedFromId = null) {
  const rule = getCertificateRule(event.id, role);
  if (!rule || !rule.background_id) throw new Error('Configure a regra e o fundo do certificado antes da emissão.');
  const participant = getCertificateCandidates(event.id, role, rule).find((item) => Number(item.user_id) === Number(userId));
  if (!participant || !participant.eligible) throw new Error('Participante não elegível pela regra de presença.');

  const attendedActivities = participant.attended_activities || getRoleActivityAttendance(event.id, userId, role).attended_activities;

  const totalActivities = attendedActivities.length;
  const totalWorkloadHours = attendedActivities.reduce((total, activity) => total + (Number(activity.workload_hours) || 0), 0);
  const mainActivityId = attendedActivities.length > 0 ? (attendedActivities[0].activity_id || attendedActivities[0].id) : null;
  const activitiesSummary = attendedActivities.map((activity) => activity.activity_name || activity.name).filter(Boolean).join('; ');
  const textColor = participant.text_color || rule.text_color || '#0f172a';

  const version = (participant.latest_version || 0) + 1;
  const code = `CERT-${event.id}-${userId}-${role.toUpperCase()}-V${version}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const issuedAt = new Date(Date.now() - 3 * 3600000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  return db.prepare(`INSERT INTO certificate_emissions (event_id,registration_id,user_id,certificate_role,background_id,certificate_code,version,attendance_count,participant_name,event_name,event_date_start,event_date_end,issued_by,reissued_from_id,issued_at,activity_id,activities_attended,total_workload_hours,activities_summary,text_color,certificate_title,certificate_body)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      event.id, participant.registration_id || null, userId, role, rule.background_id, code, version,
      participant.attendance_count, participant.name, event.name,
      event.date_start, event.date_end, actorUserId, reissuedFromId,
      issuedAt, mainActivityId, totalActivities, totalWorkloadHours, activitiesSummary, textColor,
      certificateText(rule.title || certificateRoleMeta(role).title, event.name), certificateText(rule.body_text || certificateRoleMeta(role).body, event.name)
    ).lastInsertRowid;
}

router.post('/:id/certificates/:role/:userId/issue', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  const role = CERTIFICATE_ROLES[req.params.role] ? req.params.role : null;
  if (!event || !role) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  try { const emissionId = issueCertificate(event, role, req.params.userId, req.session.userId); recordParticipantAudit({ eventId: event.id, actorUserId: req.session.userId, action: 'certificate_issued', details: { emission_id: emissionId, role, user_id: req.params.userId } }); }
  catch (error) { return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent(error.message)}`); }
  res.redirect(`/admin/events/${req.params.id}/certificates?success=${encodeURIComponent('Certificado emitido com sucesso.')}`);
});

router.post('/:id/certificates/issue-all', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não foi encontrado.' });

  let issued = 0;
  let skipped = 0;
  const issueAll = db.transaction(() => {
    Object.keys(CERTIFICATE_ROLES).forEach((role) => {
      const rule = getCertificateRule(event.id, role);
      const candidates = getCertificateCandidates(event.id, role, rule);
      candidates.forEach((candidate) => {
        if (!candidate.eligible || candidate.active_emission_id) return;
        try {
          const emissionId = issueCertificate(event, role, candidate.user_id, req.session.userId);
          recordParticipantAudit({
            eventId: event.id,
            registrationId: candidate.registration_id || null,
            actorUserId: req.session.userId,
            action: 'certificate_issued_batch',
            details: { emission_id: emissionId, role, user_id: candidate.user_id }
          });
          issued += 1;
        } catch (_) {
          skipped += 1;
        }
      });
    });
  });
  issueAll();

  const message = issued
    ? `${issued} certificado(s) emitido(s) em lote${skipped ? `; ${skipped} não puderam ser emitidos porque falta configuração.` : '.'}`
    : (skipped ? 'Nenhum certificado foi emitido. Configure fundo e regra para os perfis pendentes.' : 'Não há certificados elegíveis pendentes de emissão.');
  const key = issued ? 'success' : 'error';
  res.redirect(`/admin/events/${event.id}/certificates?${key}=${encodeURIComponent(message)}`);
});

router.post('/:id/certificates/:role/:userId/reissue', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  const role = CERTIFICATE_ROLES[req.params.role] ? req.params.role : null;
  if (!event || !role) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  const previous = db.prepare(`SELECT id FROM certificate_emissions WHERE event_id=? AND user_id=? AND certificate_role=? AND status='issued' ORDER BY version DESC LIMIT 1`).get(event.id, req.params.userId, role);
  if (!previous) return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent('Não há certificado ativo para reemitir.')}`);
  try { const emissionId = issueCertificate(event, role, req.params.userId, req.session.userId, previous.id); db.prepare("UPDATE certificate_emissions SET status='reissued' WHERE id=?").run(previous.id); recordParticipantAudit({ eventId:event.id, actorUserId:req.session.userId, action:'certificate_reissued', details:{ previous_emission_id:previous.id, emission_id:emissionId, role, user_id:req.params.userId } }); }
  catch (error) { return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent(error.message)}`); }
  res.redirect(`/admin/events/${event.id}/certificates?success=${encodeURIComponent('Certificado reemitido com nova versão.')}`);
});

router.get('/:id/certificates/emissions/:emissionId/download', (req, res) => {
  const certificate = db.prepare(`SELECT ce.*, cb.file_path AS background_path FROM certificate_emissions ce LEFT JOIN certificate_backgrounds cb ON cb.id=ce.background_id WHERE ce.id=? AND ce.event_id=?`).get(req.params.emissionId, req.params.id);
  if (!certificate) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  res.type('application/pdf'); res.attachment(`certificado-${certificate.certificate_code}.pdf`); renderCertificatePdf(res, certificate);
});

router.get('/:id/roles', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const assignments = db.prepare(`SELECT eur.*, u.name AS user_name, u.email AS user_email, a.title AS article_title
    FROM event_user_roles eur JOIN users u ON u.id=eur.user_id LEFT JOIN articles a ON a.id=eur.article_id
    WHERE eur.event_id=? ORDER BY eur.role, u.name COLLATE NOCASE`).all(event.id);
  const users = db.prepare(`SELECT id,name,email,is_speaker,is_teacher,is_oral_presenter,is_poster_presenter FROM users WHERE is_public=1 AND approval_status='approved' ORDER BY name COLLATE NOCASE`).all();
  const articles = db.prepare(`SELECT id,title,type FROM articles WHERE event_id=? AND status='approved' ORDER BY title COLLATE NOCASE`).all(event.id);
  res.render('admin/events/roles', { title: `Papéis do evento - ${event.name}`, event, assignments, users, articles, roleMeta: { ...CERTIFICATE_ROLES, admin: { label: 'Administrador do evento' } }, success: req.query.success || null, error: req.query.error || null });
});

router.post('/:id/roles', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  const role = ['admin', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter'].includes(req.body.role) ? req.body.role : null;
  const userId = parseInt(req.body.user_id, 10);
  if (!event || !role || !Number.isInteger(userId)) return res.redirect(`/admin/events/${req.params.id}/roles?error=${encodeURIComponent('Informe uma pessoa e um papel válidos.')}`);
  let articleId = null;
  const profileColumn = { speaker: 'is_speaker', teacher: 'is_teacher', oral_presenter: 'is_oral_presenter', poster_presenter: 'is_poster_presenter' }[role];
  const user = profileColumn ? db.prepare(`SELECT id, ${profileColumn} AS profile_enabled FROM users WHERE id=?`).get(userId) : db.prepare('SELECT id, 1 AS profile_enabled FROM users WHERE id=?').get(userId);
  if (!user || !user.profile_enabled) return res.redirect(`/admin/events/${event.id}/roles?error=${encodeURIComponent('Ative primeiro este perfil no cadastro do usuário.')}`);
  if (role === 'oral_presenter' || role === 'poster_presenter') {
    articleId = parseInt(req.body.article_id, 10);
    const article = db.prepare(`SELECT id FROM articles WHERE id=? AND event_id=? AND status='approved' AND type=?`).get(articleId, event.id, role === 'oral_presenter' ? 'oral' : 'poster');
    if (!article) return res.redirect(`/admin/events/${event.id}/roles?error=${encodeURIComponent('Selecione um artigo aprovado com a modalidade correspondente.')}`);
  }
  try {
    db.prepare(`INSERT INTO event_user_roles (event_id,user_id,role,article_id,assigned_by) VALUES (?,?,?,?,?)`).run(event.id, userId, role, articleId, req.session.userId);
  } catch (error) {
    return res.redirect(`/admin/events/${event.id}/roles?error=${encodeURIComponent('Esta pessoa já possui esse papel no evento.')}`);
  }
  res.redirect(`/admin/events/${event.id}/roles?success=${encodeURIComponent('Papel atribuído com sucesso.')}`);
});

router.post('/:id/roles/:role/:userId/delete', strictLimiter, (req, res) => {
  const role = ['admin', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter'].includes(req.params.role) ? req.params.role : null;
  if (role) db.prepare('DELETE FROM event_user_roles WHERE event_id=? AND user_id=? AND role=?').run(req.params.id, req.params.userId, role);
  res.redirect(`/admin/events/${req.params.id}/roles?success=${encodeURIComponent('Papel removido.')}`);
});

router.get('/:id/participants/new', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  res.render('admin/events/participant-form', {
    title: `Adicionar Participante - ${event.name}`,
    event,
    registration: null,
    formData: { name: '', email: '', institution: '', registration_type: 'listener', account_mode: 'new', existing_user_id: '', activity_ids: [] },
    availableUsers: getUsersForParticipantSelection(),
    activities: getActivitiesForParticipantForm(event.id),
    error: null
  });
});

function getUsersForParticipantSelection() {
  return db.prepare(`
    SELECT id, name, email, institution, is_public, approval_status
    FROM users
    WHERE is_public = 1
      AND approval_status = 'approved'
    ORDER BY name COLLATE NOCASE, email COLLATE NOCASE
  `).all();
}

function getActivitiesForParticipantForm(eventId) {
  return db.prepare(`SELECT id,name,activity_type,activity_date,workload_hours,certificate_enabled
    FROM event_activities WHERE event_id=? ORDER BY activity_date,name COLLATE NOCASE`).all(eventId);
}

function normalizeActivityIds(value) {
  const submitted = Array.isArray(value) ? value : [value];
  return [...new Set(submitted.map((id) => Number(id)).filter(Number.isInteger))];
}

function getParticipantActivityIds(registrationId) {
  if (!registrationId) return [];
  return db.prepare('SELECT activity_id FROM participant_activity_enrollments WHERE registration_id=? ORDER BY activity_id')
    .all(registrationId).map((row) => Number(row.activity_id));
}

function validateParticipantActivities(eventId, activityIds) {
  const available = getActivitiesForParticipantForm(eventId);
  if (available.length > 0 && activityIds.length === 0) return 'Selecione ao menos uma atividade para o participante.';
  const availableIds = new Set(available.map((activity) => Number(activity.id)));
  if (activityIds.some((id) => !availableIds.has(id))) return 'Uma das atividades selecionadas não pertence a este evento.';
  return null;
}

function saveParticipantActivities(registrationId, userId, activityIds, actorUserId) {
  db.prepare('DELETE FROM participant_activity_enrollments WHERE registration_id=?').run(registrationId);
  const insert = db.prepare(`INSERT INTO participant_activity_enrollments
    (activity_id,registration_id,user_id,enrolled_by,created_at,updated_at)
    VALUES(?,?,?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))`);
  activityIds.forEach((activityId) => insert.run(activityId, registrationId, userId, actorUserId));
}

function getParticipantEventRoles(eventId, userId) {
  if (!userId) return [];
  return db.prepare('SELECT role, article_id FROM event_user_roles WHERE event_id=? AND user_id=?').all(eventId, userId);
}

function getApprovedEventArticles(eventId) {
  return db.prepare("SELECT id, title, type FROM articles WHERE event_id=? AND status='approved' ORDER BY title COLLATE NOCASE").all(eventId);
}

function requestedEventRoles(body = {}) {
  const allowed = ['speaker', 'teacher', 'oral_presenter', 'poster_presenter'];
  const selected = Array.isArray(body.event_roles) ? body.event_roles : [body.event_roles];
  return allowed.filter((role) => selected.includes(role)).map((role) => ({
    role,
    articleId: role === 'oral_presenter' ? parseInt(body.oral_article_id, 10) : role === 'poster_presenter' ? parseInt(body.poster_article_id, 10) : null
  }));
}

function validateAndSaveParticipantEventRoles(eventId, userId, body, actorUserId) {
  if (!userId) return 'A inscrição precisa estar vinculada a uma conta para receber papéis no evento.';
  const roles = requestedEventRoles(body);
  for (const item of roles) {
    if (item.role === 'oral_presenter' || item.role === 'poster_presenter') {
      const type = item.role === 'oral_presenter' ? 'oral' : 'poster';
      const article = db.prepare("SELECT id FROM articles WHERE id=? AND event_id=? AND status='approved' AND type=?").get(item.articleId, eventId, type);
      if (!article) return `Selecione um artigo aprovado na modalidade ${type === 'oral' ? 'oral' : 'pôster'} para o papel de apresentador.`;
    }
  }
  db.transaction(() => {
    // A edição de participação gerencia apenas os papéis operacionais abaixo.
    // Papéis administrativos e de revisão são preservados e gerenciados no fluxo próprio.
    db.prepare("DELETE FROM event_user_roles WHERE event_id=? AND user_id=? AND role IN ('speaker','teacher','oral_presenter','poster_presenter')").run(eventId, userId);
    const insert = db.prepare('INSERT INTO event_user_roles (event_id,user_id,role,article_id,assigned_by) VALUES (?,?,?,?,?)');
    roles.forEach((item) => insert.run(eventId, userId, item.role, item.articleId || null, actorUserId));
  })();
  return null;
}

function renderParticipantFormError(res, event, registration, formData, error) {
  return res.status(400).render('admin/events/participant-form', {
    title: `${registration ? 'Editar' : 'Adicionar'} Participante - ${event.name}`,
    event,
    registration,
    formData,
    availableUsers: getUsersForParticipantSelection(),
    activities: getActivitiesForParticipantForm(event.id),
    eventRoles: getParticipantEventRoles(event.id, registration && registration.user_id),
    approvedArticles: getApprovedEventArticles(event.id),
    error
  });
}

function normalizeParticipantForm(body = {}) {
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    institution: String(body.institution || '').trim(),
    registration_type: body.registration_type === 'author' ? 'author' : 'listener',
    account_mode: body.account_mode === 'existing' ? 'existing' : 'new',
    existing_user_id: String(body.existing_user_id || '').trim(),
    activity_ids: normalizeActivityIds(body.activity_ids)
  };
}

function validateParticipantForm(formData) {
  if (!formData.name || !formData.email) return 'Nome e e-mail são obrigatórios.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Informe um e-mail válido.';
  return null;
}

router.post('/:id/participants', strictLimiter, (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const formData = normalizeParticipantForm(req.body);
  let linkedUser = null;
  if (formData.account_mode === 'existing') {
    if (!formData.existing_user_id) {
      return renderParticipantFormError(res, event, null, formData, 'Selecione uma conta já cadastrada para inscrevê-la no evento.');
    }
    linkedUser = db.prepare(`
      SELECT id, name, email, institution
      FROM users
      WHERE id = ? AND is_public = 1 AND approval_status = 'approved'
      LIMIT 1
    `).get(formData.existing_user_id);
    if (!linkedUser) {
      return renderParticipantFormError(res, event, null, formData, 'A conta selecionada não está disponível para inscrição. Escolha uma conta ativa e aprovada.');
    }
    // O vínculo explícito sempre usa os dados atuais da conta selecionada.
    formData.name = linkedUser.name;
    formData.email = String(linkedUser.email || '').trim().toLowerCase();
    formData.institution = linkedUser.institution || '';
  }

  const validationError = validateParticipantForm(formData);
  if (validationError) return renderParticipantFormError(res, event, null, formData, validationError);
  const activityValidationError = validateParticipantActivities(event.id, formData.activity_ids);
  if (activityValidationError) return renderParticipantFormError(res, event, null, formData, activityValidationError);

  const temporaryPassword = String(req.body.temporary_password || '');
  const confirmTemporaryPassword = String(req.body.confirm_temporary_password || '');
  if (formData.account_mode === 'new') {
    if (temporaryPassword.length < 6) {
      return renderParticipantFormError(res, event, null, formData, 'A senha temporária deve ter pelo menos 6 caracteres.');
    }
    if (temporaryPassword !== confirmTemporaryPassword) {
      return renderParticipantFormError(res, event, null, formData, 'A confirmação da senha temporária não confere.');
    }
    const existingEmail = db.prepare(`
      SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1
    `).get(formData.email);
    if (existingEmail) {
      return renderParticipantFormError(res, event, null, formData, 'Já existe uma conta com este e-mail. Selecione a opção de conta existente para inscrevê-la.');
    }
  }

  try {
    const createParticipantAndRegistration = db.transaction(() => {
      if (formData.account_mode === 'new') {
        const newUser = db.prepare(`
          INSERT INTO users (
            name, email, password, institution, is_public, approval_status, approved_at, password_changed, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, 'approved', datetime('now', '-3 hours'), 0, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
        `).run(
          formData.name,
          formData.email,
          bcrypt.hashSync(temporaryPassword, 10),
          formData.institution || null
        );
        linkedUser = { id: newUser.lastInsertRowid };
      }

      const result = db.prepare(`
        INSERT INTO event_registrations (
          event_id, user_id, name, email, institution, registration_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
      `).run(event.id, linkedUser.id, formData.name, formData.email, formData.institution, formData.registration_type);
      db.prepare("UPDATE users SET is_participant=1, updated_at=datetime('now','-3 hours') WHERE id=?").run(linkedUser.id);
      saveParticipantActivities(result.lastInsertRowid, linkedUser.id, formData.activity_ids, req.session.userId);

      recordParticipantAudit({
        eventId: event.id,
        registrationId: result.lastInsertRowid,
        actorUserId: req.session.userId,
        action: formData.account_mode === 'new' ? 'participant_account_created_and_registered' : 'existing_account_registered_manually',
        details: { ...formData, linked_user_id: linkedUser.id, activity_ids: formData.activity_ids }
      });
    });
    createParticipantAndRegistration();
  } catch (error) {
    if (error && String(error.message).includes('UNIQUE constraint failed')) {
      return renderParticipantFormError(res, event, null, formData, 'Já existe uma inscrição para este e-mail ou conta neste evento.');
    }
    throw error;
  }

  res.redirect(`/admin/events/${event.id}/participants?success=${encodeURIComponent('Participante adicionado com sucesso.')}`);
});

router.get('/:id/participants/:registrationId/edit', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const registration = getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado' });

  res.render('admin/events/participant-form', {
    title: `Editar Participante - ${event.name}`,
    event,
    registration,
    formData: {
      name: registration.name || '',
      email: registration.email || '',
      institution: registration.institution || '',
      registration_type: registration.registration_type || 'listener',
      existing_user_id: registration.user_id || '',
      activity_ids: getParticipantActivityIds(registration.id)
    },
    availableUsers: getUsersForParticipantSelection(),
    activities: getActivitiesForParticipantForm(event.id),
    eventRoles: getParticipantEventRoles(event.id, registration.user_id),
    approvedArticles: getApprovedEventArticles(event.id),
    error: null
  });
});

function updateParticipant(req, res) {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const registration = getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado' });

  const formData = normalizeParticipantForm(req.body);

  const validationError = validateParticipantForm(formData);
  if (validationError) return renderParticipantFormError(res, event, registration, formData, validationError);
  const activityValidationError = validateParticipantActivities(event.id, formData.activity_ids);
  if (activityValidationError) return renderParticipantFormError(res, event, registration, formData, activityValidationError);

  if (registration.submitted_articles > 0 && formData.registration_type !== 'author') {
    return renderParticipantFormError(res, event, registration, formData, 'Participantes com artigo submetido não podem ser rebaixados para participante sem artigo.');
  }

  try {
    const previousActivityIds = getParticipantActivityIds(registration.id);
    db.transaction(() => {
      db.prepare(`UPDATE event_registrations
        SET name=?,email=?,institution=?,registration_type=?,updated_at=datetime('now','-3 hours')
        WHERE id=? AND event_id=?`).run(formData.name, formData.email, formData.institution,
        formData.registration_type, req.params.registrationId, req.params.id);
      saveParticipantActivities(registration.id, registration.user_id, formData.activity_ids, req.session.userId);
      recordParticipantAudit({
        eventId: event.id, registrationId: registration.id, actorUserId: req.session.userId,
        action: 'participant_updated_manually',
        details: {
          previous: { name: registration.name, email: registration.email, institution: registration.institution,
            registration_type: registration.registration_type, activity_ids: previousActivityIds },
          current: formData
        }
      });
    })();
  } catch (error) {
    if (error && String(error.message).includes('UNIQUE constraint failed')) {
      return renderParticipantFormError(res, event, registration, formData, 'Já existe uma inscrição para este e-mail ou conta neste evento.');
    }
    throw error;
  }

  res.redirect(`/admin/events/${req.params.id}/participants?success=${encodeURIComponent('Participante atualizado com sucesso.')}`);
}

// O formulário HTML usa POST diretamente; PUT permanece para integrações legadas.
router.post('/:id/participants/:registrationId', updateParticipant);
router.put('/:id/participants/:registrationId', updateParticipant);

router.delete('/:id/participants/:registrationId', (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const registration = getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado' });

  if (registration.submitted_articles > 0) {
    return res.redirect(`/admin/events/${event.id}/participants?error=${encodeURIComponent('Não é possível remover participante com artigo submetido. Exclua os artigos primeiro; a inscrição será convertida para participante sem artigo quando não houver mais submissões.')}`);
  }

  db.prepare('DELETE FROM event_registrations WHERE id = ? AND event_id = ?').run(registration.id, event.id);
  recordParticipantAudit({
    eventId: event.id,
    registrationId: registration.id,
    actorUserId: req.session.userId,
    action: 'participant_deleted_manually',
    details: { name: registration.name, email: registration.email, registration_type: registration.registration_type }
  });
  res.redirect(`/admin/events/${event.id}/participants?success=${encodeURIComponent('Participante removido com sucesso.')}`);
});

router.get('/:id/subsidies/:registrationId/document/:documentType', (req, res) => {
  const documentMap = {
    'academic-history': {
      pathField: 'academic_history_pdf_path',
      nameField: 'academic_history_original_name'
    },
    'motivation-letter': {
      pathField: 'motivation_letter_pdf_path',
      nameField: 'motivation_letter_original_name'
    },
    'recommendation-letter': {
      pathField: 'recommendation_letter_pdf_path',
      nameField: 'recommendation_letter_original_name'
    }
  };

  const documentConfig = documentMap[req.params.documentType];
  if (!documentConfig) {
    return res.status(404).render('error', { title: 'Documento não encontrado' });
  }

  const registration = db.prepare(`
    SELECT *
    FROM event_registrations
    WHERE id = ?
      AND event_id = ?
      AND subsidy_requested = 1
  `).bind(req.params.registrationId, req.params.id).get();

  if (!registration) {
    return res.status(404).render('error', { title: 'Pedido de subsídio não encontrado' });
  }

  const fileName = registration[documentConfig.pathField];
  const originalName = registration[documentConfig.nameField] || 'documento.pdf';
  if (!fileName) {
    return res.status(404).render('error', { title: 'Documento não encontrado' });
  }

  res.type('application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${String(originalName).replace(/"/g, '')}"`);
  return res.sendFile(path.join(__dirname, '..', 'uploads', fileName));
});

router.post('/:id/subsidies/:registrationId/decision', strictLimiter, (req, res) => {
  const { subsidy_status, subsidy_review_notes } = req.body;
  const normalizedStatus = subsidy_status === 'approved' ? 'approved' : subsidy_status === 'rejected' ? 'rejected' : null;

  if (!normalizedStatus) {
    return res.redirect(`/admin/events/${req.params.id}/subsidies`);
  }

  const registration = db.prepare(`
    SELECT id
    FROM event_registrations
    WHERE id = ?
      AND event_id = ?
      AND subsidy_requested = 1
  `).bind(req.params.registrationId, req.params.id).get();

  if (!registration) {
    return res.status(404).render('error', { title: 'Pedido de subsídio não encontrado' });
  }

  db.prepare(`
    UPDATE event_registrations
    SET subsidy_status = ?, subsidy_review_notes = ?, subsidy_reviewed_at = datetime('now', '-3 hours'),
        subsidy_reviewed_by = ?, updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `).bind(
    normalizedStatus,
    String(subsidy_review_notes || '').trim(),
    req.session.userId,
    req.params.registrationId
  ).run();

  res.redirect(`/admin/events/${req.params.id}/subsidies`);
});

// Publicar evento
router.post('/:id/publish', strictLimiter, (req, res) => {
  db.prepare("UPDATE events SET status = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").bind('published', req.params.id).run();
  res.redirect('/admin/events');
});

module.exports = router;
