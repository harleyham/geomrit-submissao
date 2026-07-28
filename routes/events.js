const express = require('express');
const router = express.Router();
const { db } = require('../db');

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

function validateEventDates({ date_start, date_end, submission_start, submission_end }) {
  if (date_start && date_end && date_end < date_start) {
    return 'A data final do evento não pode ser anterior à data inicial.';
  }

  if (submission_start && submission_end && submission_end < submission_start) {
    return 'A data final do período de submissão não pode ser anterior à data inicial.';
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

// Listar eventos
router.get('/', (req, res) => {
  const authorRegistrationByEventId = new Map(getAuthorRegistrationCountByEvent().map((row) => [row.event_id, row.count]));
  const listenerRegistrationByEventId = new Map(getListenerRegistrationCountByEvent().map((row) => [row.event_id, row.count]));
  const events = db.prepare('SELECT * FROM events ORDER BY date_start DESC').all().map((event) => ({
    ...withAreaMeta(event),
    author_registered_count: authorRegistrationByEventId.get(event.id) || 0,
    listener_registered_count: listenerRegistrationByEventId.get(event.id) || 0,
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
  const { _method, name, short_name, description, date_start, date_end, location, url, area, status, institution, language, submission_start, submission_end, offers_subsidy } = req.body;
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const validationError = validateEventDates({ date_start, date_end, submission_start, submission_end });

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
          offers_subsidy: offersSubsidy,
          status: status || 'draft',
          institution,
          language,
          submission_start,
          submission_end
        }),
        title: 'Editar Evento',
        error: validationError
      });
    }

    const id = req.params.id;
    db.prepare(`
      UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, offers_subsidy=?, status=?, institution=?, language=?, submission_start=?, submission_end=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, offersSubsidy, status || 'draft', institution || '', language || '', submission_start || null, submission_end || null, id).run();
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
        offers_subsidy: offersSubsidy,
        status: status || 'draft',
        institution,
        language,
        submission_start,
        submission_end
      }),
      title: 'Editar Evento',
      error: validationError
    });
  }

  const id = req.params.id;
  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, offers_subsidy=?, status=?, institution=?, language=?, submission_start=?, submission_end=?, updated_at=datetime('now')
    WHERE id=?
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, offersSubsidy, status || 'draft', institution || '', language || '', submission_start || null, submission_end || null, id).run();
  res.redirect('/admin/events');
});

// Criar evento
router.post('/', (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, institution, language, submission_start, submission_end, offers_subsidy } = req.body;
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const validationError = validateEventDates({ date_start, date_end, submission_start, submission_end });

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
        offers_subsidy: offersSubsidy,
        status: status || 'draft',
        institution,
        language,
        submission_start,
        submission_end
      }),
      title: 'Novo Evento',
      error: validationError
    });
  }

  db.prepare(`
    INSERT INTO events (name, short_name, description, date_start, date_end, location, url, area, offers_subsidy, status, institution, language, submission_start, submission_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, offersSubsidy, status || 'draft', institution || '', language || '', submission_start || null, submission_end || null).run();
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
  const { name, short_name, description, date_start, date_end, location, url, area, status, institution, language, submission_start, submission_end, offers_subsidy } = req.body;
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const validationError = validateEventDates({ date_start, date_end, submission_start, submission_end });

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
        offers_subsidy: offersSubsidy,
        status: status || 'draft',
        institution,
        language,
        submission_start,
        submission_end
      }),
      title: 'Editar Evento',
      error: validationError
    });
  }

  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, offers_subsidy=?, status=?, institution=?, language=?, submission_start=?, submission_end=?, updated_at=datetime('now')
    WHERE id=?
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, offersSubsidy, status, institution || '', language || '', submission_start || null, submission_end || null, req.params.id).run();
  res.redirect('/admin/events');
});

// Deletar evento
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').bind(req.params.id).run();
  res.redirect('/admin/events');
});

// Stats do evento
router.get('/:id/stats', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const totalArticles = db.prepare("SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status != 'draft'").bind(req.params.id).get().cnt;
  const authorRegistrations = db.prepare(`
    SELECT COUNT(DISTINCT CASE
      WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
      WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
      ELSE NULL
    END) as cnt
    FROM articles
    WHERE event_id = ? AND status != 'draft'
  `).bind(req.params.id).get().cnt;
  const listenerRegistrations = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM event_registrations
    WHERE event_id = ? AND registration_type = 'listener'
  `).bind(req.params.id).get().cnt;
  const registeredParticipants = authorRegistrations + listenerRegistrations;
  const approved = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status = ?').bind(req.params.id, 'approved').get().cnt;
  const rejected = db.prepare('SELECT COUNT(*) as cnt FROM articles WHERE event_id = ? AND status = ?').bind(req.params.id, 'rejected').get().cnt;
  const pending = totalArticles - approved - rejected;

  const articleIds = db.prepare("SELECT id FROM articles WHERE event_id = ? AND status != 'draft'").bind(req.params.id).all().map(a => a.id);
  let reviewersCount = 0;
  let assignedCount = 0;
  const topReviewers = [];
  if (articleIds.length > 0) {
    const ids = articleIds.map(() => '?').join(',');
    reviewersCount = db.prepare(`SELECT COUNT(DISTINCT reviewer_id) as cnt FROM assignments WHERE article_id IN (${ids})`).bind(...articleIds).all()[0].cnt;
    assignedCount = db.prepare(`SELECT COUNT(DISTINCT article_id) as cnt FROM assignments WHERE article_id IN (${ids})`).bind(...articleIds).all()[0].cnt;
    topReviewers = db.prepare(`
      SELECT u.id as reviewer_id, u.name as reviewer_name, COUNT(*) as cnt
      FROM assignments a
      JOIN users u ON u.id = a.reviewer_id
      WHERE a.article_id IN (${ids})
      GROUP BY u.id ORDER BY cnt DESC LIMIT 5
    `).bind(...articleIds).all();
  }

  const articles = db.prepare("SELECT * FROM articles WHERE event_id = ? AND status != 'draft' ORDER BY created_at DESC").bind(req.params.id).all();

  res.render('admin/events/stats', {
    event, title: 'Stats - ' + event.name, year: new Date().getFullYear(),
    totalArticles, registeredParticipants, authorRegistrations, listenerRegistrations, approved, rejected, pending, reviewers: reviewersCount, assigned: assignedCount,
    articles, topReviewers
  });
});

// Publicar evento
router.post('/:id/publish', (req, res) => {
  db.prepare("UPDATE events SET status = ?, updated_at = datetime('now') WHERE id = ?").bind('published', req.params.id).run();
  res.redirect('/admin/events');
});

module.exports = router;
