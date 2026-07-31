const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, recordParticipantAudit } = require('../db');
const { renderCertificatePdf } = require('../services/certificates');

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
      COALESCE(sa.submitted_count, 0) as submitted_articles,
      COALESCE(aa.approved_count, 0) as approved_articles,
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
  const events = db.prepare('SELECT * FROM events ORDER BY date_start DESC').all().map((event) => ({
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

// POST /:id — handles form submissions with _method override (edit & delete)
router.post('/:id', (req, res) => {
  const { _method, name, short_name, description, date_start, date_end, location, url, area, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, offers_subsidy, has_article_submission } = req.body;
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

  // Handle PUT (edit event)
  if (_method === 'PUT') {
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

    const id = req.params.id;
    db.prepare(`
      UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, has_article_submission=?, offers_subsidy=?, status=?, institution=?, language=?, registration_start=?, registration_end=?, submission_start=?, submission_end=?, review_start=?, review_end=?, certificates_start=?, certificates_end=?, updated_at=datetime('now', '-3 hours')
      WHERE id=?
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, status || 'draft', institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd, normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null, id).run();
    return res.redirect('/admin/events');
  }

  // Handle DELETE
  if (_method === 'DELETE') {
    db.prepare('DELETE FROM events WHERE id = ?').bind(req.params.id).run();
    return res.redirect('/admin/events');
  }

  // Fallback: treat as update (edit)
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

  const id = req.params.id;
  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, has_article_submission=?, offers_subsidy=?, status=?, institution=?, language=?, registration_start=?, registration_end=?, submission_start=?, submission_end=?, review_start=?, review_end=?, certificates_start=?, certificates_end=?, updated_at=datetime('now', '-3 hours')
    WHERE id=?
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, status || 'draft', institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd, normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null, id).run();
  res.redirect('/admin/events');
});

// Criar evento
router.post('/', (req, res) => {
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

  db.prepare(`
    INSERT INTO events (name, short_name, description, date_start, date_end, location, url, area, has_article_submission, offers_subsidy, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, status || 'draft', institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd, normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null).run();
  res.redirect('/admin/events');
});

// Editar evento
router.get('/:id/edit', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  renderEventForm(res, { event, title: 'Editar Evento' });
});

// Atualizar evento (via PUT from method-override or fetch API)
router.put('/:id', (req, res) => {
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
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, status, institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd, normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null, req.params.id).run();
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
  const params = [event.id];
  const conditions = ['er.event_id = ?'];
  if (filters.query) {
    const term = `%${filters.query.toLowerCase()}%`;
    conditions.push(`(LOWER(er.name) LIKE ? OR LOWER(er.email) LIKE ? OR LOWER(COALESCE(er.institution, '')) LIKE ?)`);
    params.push(term, term, term);
  }

  let participants = db.prepare(`
    SELECT er.id, er.name, er.email, er.institution, er.registration_type,
      ar.id AS attendance_id, ar.attended_at, ar.notes, ar.created_at AS attendance_created_at,
      marker.name AS marked_by_name,
      CASE WHEN ar.id IS NULL THEN 0 ELSE 1 END AS attendance_total
    FROM event_registrations er
    LEFT JOIN attendance_records ar ON ar.registration_id = er.id AND ar.event_id = er.event_id
    LEFT JOIN users marker ON marker.id = ar.marked_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY er.name COLLATE NOCASE
  `).bind(...params).all();

  if (filters.status === 'present') participants = participants.filter((participant) => participant.attendance_total === 1);
  if (filters.status === 'absent') participants = participants.filter((participant) => participant.attendance_total === 0);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS registered,
      COALESCE(SUM(CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS present
    FROM event_registrations er
    LEFT JOIN attendance_records ar ON ar.registration_id = er.id AND ar.event_id = er.event_id
    WHERE er.event_id = ?
  `).get(event.id);

  res.render('admin/events/attendance', {
    title: `Presença - ${event.name}`,
    event,
    participants,
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

router.post('/:id/attendance/:registrationId', (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const registration = db.prepare(`
    SELECT id, name, email FROM event_registrations WHERE id = ? AND event_id = ?
  `).bind(req.params.registrationId, event.id).get();
  if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado' });

  const action = req.body.action === 'mark_absent' ? 'mark_absent' : 'mark_present';
  const notes = String(req.body.notes || '').trim();
  if (action === 'mark_absent') {
    const removed = db.prepare(`
      DELETE FROM attendance_records WHERE event_id = ? AND registration_id = ?
    `).run(event.id, registration.id);
    if (removed.changes) {
      recordParticipantAudit({
        eventId: event.id,
        registrationId: registration.id,
        actorUserId: req.session.userId,
        action: 'attendance_removed',
        details: { participant_name: registration.name, participant_email: registration.email }
      });
    }
    return res.redirect(`/admin/events/${event.id}/attendance?success=${encodeURIComponent('Presença removida; participante marcado como ausente.')}`);
  }

  db.prepare(`
    INSERT INTO attendance_records (event_id, registration_id, marked_by, attended_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now', '-3 hours'), ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
    ON CONFLICT(event_id, registration_id) DO UPDATE SET
      marked_by = excluded.marked_by,
      attended_at = excluded.attended_at,
      notes = excluded.notes,
      updated_at = datetime('now', '-3 hours')
  `).run(event.id, registration.id, req.session.userId, notes);
  recordParticipantAudit({
    eventId: event.id,
    registrationId: registration.id,
    actorUserId: req.session.userId,
    action: 'attendance_marked_present',
    details: { participant_name: registration.name, participant_email: registration.email, notes }
  });
  return res.redirect(`/admin/events/${event.id}/attendance?success=${encodeURIComponent('Presença registrada com sucesso.')}`);
});

function getCertificateParticipants(eventId, minAttendance) {
  return db.prepare(`
    SELECT er.id, er.name, er.email, er.registration_type,
      COUNT(ar.id) AS attendance_count,
      (SELECT MAX(version) FROM certificate_emissions ce WHERE ce.event_id = er.event_id AND ce.registration_id = er.id) AS latest_version,
      (SELECT id FROM certificate_emissions ce WHERE ce.event_id = er.event_id AND ce.registration_id = er.id AND ce.status = 'issued' ORDER BY version DESC LIMIT 1) AS active_emission_id
    FROM event_registrations er
    LEFT JOIN attendance_records ar ON ar.event_id = er.event_id AND ar.registration_id = er.id
    WHERE er.event_id = ?
    GROUP BY er.id
    ORDER BY er.name COLLATE NOCASE
  `).all(eventId).map((participant) => ({ ...participant, eligible: participant.attendance_count >= minAttendance }));
}

router.get('/:id/certificates', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const rule = db.prepare('SELECT * FROM certificate_rules WHERE event_id = ?').get(event.id) || { min_attendance: 1, background_id: null };
  const backgrounds = db.prepare('SELECT * FROM certificate_backgrounds ORDER BY created_at DESC').all();
  res.render('admin/events/certificates', {
    title: `Certificados - ${event.name}`,
    event,
    rule,
    backgrounds,
    participants: getCertificateParticipants(event.id, rule.min_attendance),
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/:id/activities', (req,res)=>{const event=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!event)return res.status(404).render('error',{title:'Evento não encontrado'});const activities=db.prepare('SELECT * FROM event_activities WHERE event_id=? ORDER BY activity_date,name').all(event.id);res.render('admin/events/activities',{title:`Atividades - ${event.name}`,event,activities});});
router.post('/:id/activities',(req,res)=>{const event=db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);if(!event)return res.status(404).render('error',{title:'Evento não encontrado'});const name=String(req.body.name||'').trim();if(!name)return res.redirect(`/admin/events/${event.id}/activities`);db.prepare("INSERT INTO event_activities(event_id,name,activity_type,activity_date,workload_hours,certificate_enabled) VALUES(?,?,?,?,?,?)").run(event.id,name,String(req.body.activity_type||'other'),req.body.activity_date||null,Number(req.body.workload_hours)||0,req.body.certificate_enabled?1:0);res.redirect(`/admin/events/${event.id}/activities`);});
router.get('/:id/activities/:activityId/attendance',(req,res)=>{const activity=db.prepare('SELECT a.*,e.name event_name FROM event_activities a JOIN events e ON e.id=a.event_id WHERE a.id=? AND a.event_id=?').get(req.params.activityId,req.params.id);if(!activity)return res.status(404).render('error',{title:'Atividade não encontrada'});const participants=db.prepare('SELECT er.*,CASE WHEN aar.id IS NULL THEN 0 ELSE 1 END present FROM event_registrations er LEFT JOIN activity_attendance_records aar ON aar.registration_id=er.id AND aar.activity_id=? WHERE er.event_id=? ORDER BY er.name').all(activity.id,activity.event_id);res.render('admin/events/activity-attendance',{title:`Presença - ${activity.name}`,activity,participants});});
router.post('/:id/activities/:activityId/attendance/:registrationId',(req,res)=>{const activity=db.prepare('SELECT id,event_id FROM event_activities WHERE id=? AND event_id=?').get(req.params.activityId,req.params.id);if(!activity)return res.status(404).render('error',{title:'Atividade não encontrada'});if(req.body.action==='absent')db.prepare('DELETE FROM activity_attendance_records WHERE activity_id=? AND registration_id=?').run(activity.id,req.params.registrationId);else db.prepare("INSERT INTO activity_attendance_records(activity_id,registration_id,marked_by) VALUES(?,?,?) ON CONFLICT(activity_id,registration_id) DO UPDATE SET marked_by=excluded.marked_by,attended_at=datetime('now','-3 hours')").run(activity.id,req.params.registrationId,req.session.userId);res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance`);});

router.post('/:id/certificates/rule', (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const minAttendance = Math.max(1, parseInt(req.body.min_attendance, 10) || 1);
  const backgroundId = req.body.background_id ? parseInt(req.body.background_id, 10) : null;
  if (!backgroundId || !db.prepare('SELECT id FROM certificate_backgrounds WHERE id = ?').get(backgroundId)) {
    return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent('Selecione um fundo de certificado válido.')}`);
  }
  db.prepare(`INSERT INTO certificate_rules (event_id,min_attendance,background_id,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))
    ON CONFLICT(event_id) DO UPDATE SET min_attendance=excluded.min_attendance,background_id=excluded.background_id,updated_by=excluded.updated_by,updated_at=datetime('now','-3 hours')
  `).run(event.id, minAttendance, backgroundId, req.session.userId);
  res.redirect(`/admin/events/${event.id}/certificates?success=${encodeURIComponent('Regra de elegibilidade salva.')}`);
});

router.post('/:id/certificates/backgrounds', (req, res) => {
  certificateBackgroundUpload.single('background_file')(req, res, (error) => {
    if (error || !req.file || !String(req.body.name || '').trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
      const message = error && error.code === 'LIMIT_FILE_SIZE' ? 'O fundo excede 10 MB.' : 'Informe um nome e envie uma imagem PNG ou JPEG.';
      return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent(message)}`);
    }
    db.prepare(`INSERT INTO certificate_backgrounds (name,file_path,original_name,mime_type,created_by,created_at) VALUES (?,?,?,?,?,datetime('now','-3 hours'))`)
      .run(String(req.body.name).trim(), `certificate-backgrounds/${req.file.filename}`, req.file.originalname, req.file.mimetype, req.session.userId);
    return res.redirect(`/admin/events/${req.params.id}/certificates?success=${encodeURIComponent('Fundo enviado para a biblioteca.')}`);
  });
});

function issueCertificate(event, registrationId, actorUserId, reissuedFromId = null) {
  const rule = db.prepare('SELECT * FROM certificate_rules WHERE event_id = ?').get(event.id);
  if (!rule || !rule.background_id) throw new Error('Configure a regra e o fundo do certificado antes da emissão.');
  const participant = getCertificateParticipants(event.id, rule.min_attendance).find((item) => Number(item.id) === Number(registrationId));
  if (!participant || !participant.eligible) throw new Error('Participante não elegível pela regra de presença.');
  const version = (participant.latest_version || 0) + 1;
  const code = `CERT-${event.id}-${registrationId}-V${version}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return db.prepare(`INSERT INTO certificate_emissions (event_id,registration_id,background_id,certificate_code,version,attendance_count,participant_name,event_name,event_date_start,event_date_end,issued_by,reissued_from_id,issued_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','-3 hours'))`).run(event.id, registrationId, rule.background_id, code, version, participant.attendance_count, participant.name, event.name, event.date_start, event.date_end, actorUserId, reissuedFromId).lastInsertRowid;
}

router.post('/:id/certificates/:registrationId/issue', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  try { const emissionId = issueCertificate(event, req.params.registrationId, req.session.userId); recordParticipantAudit({ eventId: event.id, registrationId: req.params.registrationId, actorUserId: req.session.userId, action: 'certificate_issued', details: { emission_id: emissionId } }); }
  catch (error) { return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent(error.message)}`); }
  res.redirect(`/admin/events/${req.params.id}/certificates?success=${encodeURIComponent('Certificado emitido com sucesso.')}`);
});

router.post('/:id/certificates/:registrationId/reissue', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  const previous = db.prepare(`SELECT id FROM certificate_emissions WHERE event_id=? AND registration_id=? AND status='issued' ORDER BY version DESC LIMIT 1`).get(event.id, req.params.registrationId);
  if (!previous) return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent('Não há certificado ativo para reemitir.')}`);
  try { const emissionId = issueCertificate(event, req.params.registrationId, req.session.userId, previous.id); db.prepare("UPDATE certificate_emissions SET status='reissued' WHERE id=?").run(previous.id); recordParticipantAudit({ eventId:event.id, registrationId:req.params.registrationId, actorUserId:req.session.userId, action:'certificate_reissued', details:{ previous_emission_id:previous.id, emission_id:emissionId } }); }
  catch (error) { return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent(error.message)}`); }
  res.redirect(`/admin/events/${event.id}/certificates?success=${encodeURIComponent('Certificado reemitido com nova versão.')}`);
});

router.get('/:id/certificates/emissions/:emissionId/download', (req, res) => {
  const certificate = db.prepare(`SELECT ce.*, cb.file_path AS background_path FROM certificate_emissions ce LEFT JOIN certificate_backgrounds cb ON cb.id=ce.background_id WHERE ce.id=? AND ce.event_id=?`).get(req.params.emissionId, req.params.id);
  if (!certificate) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  res.type('application/pdf'); res.attachment(`certificado-${certificate.certificate_code}.pdf`); renderCertificatePdf(res, certificate);
});

router.get('/:id/participants/new', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  res.render('admin/events/participant-form', {
    title: `Adicionar Participante - ${event.name}`,
    event,
    registration: null,
    formData: { name: '', email: '', institution: '', registration_type: 'listener', account_mode: 'new', existing_user_id: '' },
    availableUsers: getUsersForParticipantSelection(),
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

function renderParticipantFormError(res, event, registration, formData, error) {
  return res.status(400).render('admin/events/participant-form', {
    title: `${registration ? 'Editar' : 'Adicionar'} Participante - ${event.name}`,
    event,
    registration,
    formData,
    availableUsers: getUsersForParticipantSelection(),
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
    existing_user_id: String(body.existing_user_id || '').trim()
  };
}

function validateParticipantForm(formData) {
  if (!formData.name || !formData.email) return 'Nome e e-mail são obrigatórios.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Informe um e-mail válido.';
  return null;
}

router.post('/:id/participants', (req, res) => {
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

      recordParticipantAudit({
        eventId: event.id,
        registrationId: result.lastInsertRowid,
        actorUserId: req.session.userId,
        action: formData.account_mode === 'new' ? 'participant_account_created_and_registered' : 'existing_account_registered_manually',
        details: { ...formData, linked_user_id: linkedUser.id }
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
      existing_user_id: registration.user_id || ''
    },
    availableUsers: getUsersForParticipantSelection(),
    error: null
  });
});

router.put('/:id/participants/:registrationId', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const registration = getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado' });

  const formData = normalizeParticipantForm(req.body);

  const validationError = validateParticipantForm(formData);
  if (validationError) return renderParticipantFormError(res, event, registration, formData, validationError);

  if (registration.submitted_articles > 0 && formData.registration_type !== 'author') {
    return res.render('admin/events/participant-form', {
      title: `Editar Participante - ${event.name}`,
      event,
      registration,
      formData,
      error: 'Participantes com artigo submetido não podem ser rebaixados para participante sem artigo.'
    });
  }

  try {
    db.prepare(`
      UPDATE event_registrations
      SET name = ?, email = ?, institution = ?, registration_type = ?, updated_at = datetime('now', '-3 hours')
      WHERE id = ?
        AND event_id = ?
    `).bind(
      formData.name,
      formData.email,
      formData.institution,
      formData.registration_type,
      req.params.registrationId,
      req.params.id
    ).run();
    recordParticipantAudit({
      eventId: event.id,
      registrationId: registration.id,
      actorUserId: req.session.userId,
      action: 'participant_updated_manually',
      details: { previous: { name: registration.name, email: registration.email, institution: registration.institution, registration_type: registration.registration_type }, current: formData }
    });
  } catch (error) {
    if (error && String(error.message).includes('UNIQUE constraint failed')) {
      return renderParticipantFormError(res, event, registration, formData, 'Já existe uma inscrição para este e-mail ou conta neste evento.');
    }
    throw error;
  }

  res.redirect(`/admin/events/${req.params.id}/participants?success=${encodeURIComponent('Participante atualizado com sucesso.')}`);
});

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

router.post('/:id/subsidies/:registrationId/decision', (req, res) => {
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
router.post('/:id/publish', (req, res) => {
  db.prepare("UPDATE events SET status = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").bind('published', req.params.id).run();
  res.redirect('/admin/events');
});

module.exports = router;
