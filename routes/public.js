const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../db');
const bcrypt = require('bcryptjs');

const ABSTRACT_LIMIT = 2500;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ext === '.pdf');
  }
});

function runUpload(req, res, next) {
  upload.single('article_pdf')(req, res, (err) => {
    if (!err) return next();
    req.uploadError = err.code === 'LIMIT_FILE_SIZE'
      ? 'O arquivo PDF excede o limite de 10 MB.'
      : 'Falha no upload do arquivo. Envie um PDF válido.';
    return next();
  });
}

function getSubmissionWindow(event) {
  const now = new Date();
  const start = event.submission_start ? new Date(`${event.submission_start}T00:00:00`) : null;
  const end = event.submission_end ? new Date(`${event.submission_end}T23:59:59`) : null;

  let isOpen = false;
  let isConfigured = !!(start && end);
  let message = null;

  if (!start || !end) {
    message = 'Este evento não possui período de submissão de artigos configurado.';
  } else if (now < start) {
    isOpen = false;
    message = `As submissões para este evento abrem em ${start.toLocaleDateString('pt-BR')}.`;
  } else if (now > end) {
    isOpen = false;
    message = `O período de submissão deste evento encerrou em ${end.toLocaleDateString('pt-BR')}.`;
  } else {
    isOpen = true;
  }

  return { isOpen, isConfigured, message, start, end };
}

function withSubmissionMeta(event) {
  const submission = getSubmissionWindow(event);
  const formatDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
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

function requireUserSession(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function requireNonAdminAuthorAccess(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }

  if (req.session.isAdmin) {
    return res.status(403).render('error', {
      title: 'Acesso não permitido',
      message: 'Contas com perfil de administrador não podem acessar a área de submissão de artigos.'
    });
  }

  return next();
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

function parseAreaList(areaValue) {
  return String(areaValue || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAreaOptions(currentArea) {
  return Array.from(new Set(parseAreaList(currentArea))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

function normalizeFormData(body = {}, session = null) {
  const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const names = toArray(body.author_name);
  const emails = toArray(body.author_email);
  const institutions = toArray(body.author_institution);
  const lattes = toArray(body.author_lattes);
  const orcids = toArray(body.author_orcid);
  const corresponding = toArray(body.author_corresponding);

  const authors = [];
  const maxLen = Math.max(names.length, emails.length, institutions.length, lattes.length, orcids.length, corresponding.length, 1);
  for (let index = 0; index < maxLen; index += 1) {
    authors.push({
      name: names[index] || '',
      email: emails[index] || '',
      institution: institutions[index] || '',
      lattes: lattes[index] || '',
      orcid: orcids[index] || '',
      corresponding: corresponding[index] === '1' || corresponding[index] === 'on'
    });
  }

  return {
    draft_id: body.draft_id || '',
    title: body.title || '',
    area: body.area || '',
    type: body.type || 'oral',
    abstract: body.abstract || '',
    keywords: body.keywords || '',
    funding: body.funding || '',
    presentation_needs: body.presentation_needs || '',
    contributor: body.contributor || (session && session.userName ? session.userName : ''),
    affiliation: body.affiliation || '',
    city: body.city || '',
    email_submission: body.email_submission || (session && session.userEmail ? session.userEmail : ''),
    blind_review_confirmed: body.blind_review_confirmed === '1' || body.blind_review_confirmed === 'on',
    ethics_confirmed: body.ethics_confirmed === '1' || body.ethics_confirmed === 'on',
    publication_authorized: body.publication_authorized === '1' || body.publication_authorized === 'on',
    authors
  };
}

function ensureAtLeastOneAuthor(formData) {
  if (!formData.authors.length) {
    formData.authors = [{
      name: '',
      email: '',
      institution: '',
      lattes: '',
      orcid: '',
      corresponding: true
    }];
  }
  return formData;
}

function serializeAuthors(authors) {
  return JSON.stringify(authors);
}

function formatAuthorsForLegacyField(authors) {
  return authors
    .filter((author) => author.name && author.name.trim())
    .map((author) => author.name.trim())
    .join('; ');
}

function validateSubmission(formData, event, isDraft, existingPdfPath) {
  const errors = [];
  const keywords = formData.keywords
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const validAuthors = formData.authors.filter((author) =>
    author.name.trim() || author.email.trim() || author.institution.trim() || author.lattes.trim() || author.orcid.trim()
  );
  const correspondingCount = validAuthors.filter((author) => author.corresponding).length;

  if (isDraft) {
    return errors;
  }

  if (!event.submission.isOpen) {
    errors.push(event.submission.message || 'O período de submissão deste evento está fechado.');
  }
  if (!formData.title.trim()) errors.push('O título do artigo é obrigatório.');
  if (!formData.area.trim()) errors.push('O eixo temático / trilha é obrigatório.');
  if (!formData.abstract.trim()) errors.push('O resumo / abstract é obrigatório.');
  if (formData.abstract.length > ABSTRACT_LIMIT) errors.push(`O resumo excede o limite de ${ABSTRACT_LIMIT} caracteres.`);
  if (keywords.length < 3 || keywords.length > 5) errors.push('Informe de 3 a 5 palavras-chave separadas por vírgula.');
  if (!validAuthors.length) errors.push('Informe pelo menos um autor.');
  validAuthors.forEach((author, index) => {
    if (!author.name.trim()) errors.push(`O nome do autor ${index + 1} é obrigatório.`);
    if (!author.email.trim()) errors.push(`O e-mail do autor ${index + 1} é obrigatório.`);
    if (!author.institution.trim()) errors.push(`A instituição do autor ${index + 1} é obrigatória.`);
  });
  if (!formData.email_submission.trim()) errors.push('O e-mail para submissão é obrigatório.');
  if (correspondingCount === 0) errors.push('Marque ao menos um autor como correspondente.');
  if (!formData.blind_review_confirmed) errors.push('É necessário confirmar a versão para avaliação cega.');
  if (!formData.ethics_confirmed) errors.push('É necessário aceitar a declaração de ética e originalidade.');
  if (!formData.publication_authorized) errors.push('É necessário autorizar a publicação nos anais do evento.');
  if (!existingPdfPath) errors.push('O upload do artigo completo em PDF é obrigatório.');

  return errors;
}

function removeUploadedFile(filePath) {
  if (!filePath) return;
  const absolute = path.join(uploadsDir, filePath);
  if (fs.existsSync(absolute)) {
    try { fs.unlinkSync(absolute); } catch (error) {}
  }
}

function getDraftForEditing(draftId, eventId, req) {
  if (!draftId || !req.session || !req.session.userId) return null;
  return db.prepare(`
    SELECT *
    FROM articles
    WHERE id = ?
      AND event_id = ?
      AND status = 'draft'
      AND submitter_user_id = ?
  `).bind(draftId, eventId, req.session.userId).get();
}

function buildFormDataFromDraft(draft, session) {
  let authors = [];
  try {
    authors = draft.authors_json ? JSON.parse(draft.authors_json) : [];
  } catch (error) {
    authors = [];
  }

  return ensureAtLeastOneAuthor({
    draft_id: draft.id,
    title: draft.title || '',
    area: draft.area || '',
    type: draft.type || 'oral',
    abstract: draft.abstract || '',
    keywords: draft.keywords || '',
    funding: draft.funding || '',
    presentation_needs: draft.presentation_needs || '',
    contributor: draft.contributor || (session && session.userName ? session.userName : ''),
    affiliation: draft.affiliation || '',
    city: draft.city || '',
    email_submission: draft.email_submission || (session && session.userEmail ? session.userEmail : ''),
    blind_review_confirmed: !!draft.blind_review_confirmed,
    ethics_confirmed: !!draft.ethics_confirmed,
    publication_authorized: !!draft.publication_authorized,
    authors: authors.length ? authors : []
  });
}

function syncAuthorEventRegistration(eventId, session, formData) {
  const normalizedEmail = String(formData.email_submission || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  const existingRegistration = db.prepare(`
    SELECT id
    FROM event_registrations
    WHERE event_id = ?
      AND (
        (user_id IS NOT NULL AND user_id = ?)
        OR LOWER(TRIM(email)) = ?
      )
    ORDER BY id
    LIMIT 1
  `).get(
    eventId,
    session && session.userId ? session.userId : null,
    normalizedEmail
  );

  const registrationName = String(formData.contributor || (session && session.userName) || normalizedEmail).trim();
  const registrationInstitution = String(formData.affiliation || '').trim();

  if (existingRegistration) {
    db.prepare(`
      UPDATE event_registrations
      SET user_id = ?, name = ?, email = ?, institution = ?, registration_type = 'author', updated_at = datetime('now')
      WHERE id = ?
    `).run(
      session && session.userId ? session.userId : null,
      registrationName,
      normalizedEmail,
      registrationInstitution,
      existingRegistration.id
    );
    return;
  }

  db.prepare(`
    INSERT INTO event_registrations (
      event_id, user_id, name, email, institution, registration_type, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'author', datetime('now'), datetime('now'))
  `).run(
    eventId,
    session && session.userId ? session.userId : null,
    registrationName,
    normalizedEmail,
    registrationInstitution
  );
}

function normalizeListenerRegistrationForm(body = {}, session = null) {
  return {
    name: String(body.name || (session && session.userName) || '').trim(),
    email: String(body.email || (session && session.userEmail) || '').trim().toLowerCase(),
    institution: String(body.institution || '').trim()
  };
}

function renderListenerRegistrationForm(res, event, options = {}) {
  res.render('public/event-register', {
    event: withSubmissionMeta(withAreaMeta(event)),
    title: options.title || `Inscrição no Evento - ${event.name}`,
    error: options.error || null,
    success: options.success || null,
    formData: options.formData || {},
    alreadyRegistered: !!options.alreadyRegistered,
    registrationType: options.registrationType || null
  });
}

function renderSubmissionForm(res, event, options = {}) {
  const formData = ensureAtLeastOneAuthor(options.formData || {});
  res.render('public/submit', {
    event: withAreaMeta(event),
    title: options.title || 'Submeter Artigo',
    submitted: !!options.submitted,
    submissionError: options.submissionError || null,
    successMessage: options.successMessage || null,
    access_code: options.access_code || null,
    formData,
    areaOptions: getAreaOptions(event.area),
    abstractLimit: ABSTRACT_LIMIT,
    currentFileName: options.currentFileName || null,
    editingDraft: !!options.editingDraft
  });
}

// Página inicial - lista eventos
router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT * FROM events WHERE status = 'published' ORDER BY date_start DESC
  `).all().map((event) => withSubmissionMeta(withAreaMeta(event)));
  res.render('public/home', { events, title: 'Eventos LIGEM.Redes' });
});

// Detalhes do evento
router.get('/evento/:id', (req, res) => {
  const event = withAreaMeta(db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('public/event', { event: withSubmissionMeta(event), title: event.name });
});

router.get('/evento/:id/inscricao', requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const existingRegistration = db.prepare(`
    SELECT id, registration_type
    FROM event_registrations
    WHERE event_id = ?
      AND (
        user_id = ?
        OR LOWER(TRIM(email)) = LOWER(TRIM(?))
      )
    ORDER BY id
    LIMIT 1
  `).get(req.params.id, req.session.userId, req.session.userEmail || '');

  return renderListenerRegistrationForm(res, event, {
    formData: normalizeListenerRegistrationForm({}, req.session),
    alreadyRegistered: !!existingRegistration,
    registrationType: existingRegistration ? existingRegistration.registration_type : null,
    success: existingRegistration
      ? existingRegistration.registration_type === 'author'
        ? 'Você já está inscrito neste evento como apresentador.'
        : 'Você já está inscrito neste evento como ouvinte.'
      : null
  });
});

router.post('/evento/:id/inscricao', requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const formData = normalizeListenerRegistrationForm(req.body, req.session);

  if (!formData.name || !formData.email) {
    return renderListenerRegistrationForm(res, event, {
      error: 'Nome e e-mail são obrigatórios para a inscrição no evento.',
      formData
    });
  }

  const existingRegistration = db.prepare(`
    SELECT id, registration_type
    FROM event_registrations
    WHERE event_id = ?
      AND (
        user_id = ?
        OR LOWER(TRIM(email)) = LOWER(TRIM(?))
      )
    ORDER BY id
    LIMIT 1
  `).get(req.params.id, req.session.userId, req.session.userEmail || '');

  if (existingRegistration) {
    const nextType = existingRegistration.registration_type === 'author' ? 'author' : 'listener';
    db.prepare(`
      UPDATE event_registrations
      SET name = ?, email = ?, institution = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(formData.name, formData.email, formData.institution, existingRegistration.id);

    return renderListenerRegistrationForm(res, event, {
      success: nextType === 'author'
        ? 'Sua participação já estava registrada como apresentador neste evento.'
        : 'Sua inscrição como ouvinte já estava registrada neste evento.',
      formData,
      alreadyRegistered: true,
      registrationType: nextType
    });
  }

  db.prepare(`
    INSERT INTO event_registrations (
      event_id, user_id, name, email, institution, registration_type, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'listener', datetime('now'), datetime('now'))
  `).run(event.id, req.session.userId, formData.name, formData.email, formData.institution);

  return renderListenerRegistrationForm(res, event, {
    success: 'Inscrição como ouvinte realizada com sucesso.',
    formData,
    alreadyRegistered: true,
    registrationType: 'listener'
  });
});

// Formulário de submissão
router.get('/submeter/:eventId', requireNonAdminAuthorAccess, (req, res) => {
  const event = withAreaMeta(db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.eventId).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const eventWithMeta = withSubmissionMeta(event);
  const draft = getDraftForEditing(req.query.draftId, event.id, req);
  const formData = draft
    ? buildFormDataFromDraft(draft, req.session)
    : ensureAtLeastOneAuthor(normalizeFormData({}, req.session));

  if (!eventWithMeta.submission.isOpen && !draft) {
    return renderSubmissionForm(res, eventWithMeta, {
      submissionError: eventWithMeta.submission.message,
      formData,
      currentFileName: null
    });
  }

  return renderSubmissionForm(res, eventWithMeta, {
    formData,
    currentFileName: draft ? draft.file_original_name : null,
    editingDraft: !!draft,
    successMessage: draft ? 'Rascunho carregado. Você pode continuar a edição e submeter quando estiver pronto.' : null
  });
});

// Processar submissão de artigo
router.post('/submeter/:eventId', requireNonAdminAuthorAccess, runUpload, (req, res) => {
  try {
    const event = withAreaMeta(db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.eventId).get());
    if (!event) {
      if (req.file) removeUploadedFile(req.file.filename);
      return res.status(404).render('error', { title: 'Evento não encontrado' });
    }

    const eventWithMeta = withSubmissionMeta(event);
    const formData = ensureAtLeastOneAuthor(normalizeFormData(req.body, req.session));
    const action = req.body && req.body.action === 'save_draft' ? 'save_draft' : 'submit_article';
    const isDraft = action === 'save_draft';
    const existingDraft = getDraftForEditing(formData.draft_id, event.id, req);

    if (req.uploadError) {
      if (req.file) removeUploadedFile(req.file.filename);
      return renderSubmissionForm(res, eventWithMeta, {
        submissionError: req.uploadError,
        formData,
        currentFileName: existingDraft ? existingDraft.file_original_name : null,
        editingDraft: !!existingDraft
      });
    }

    if (isDraft && (!req.session || !req.session.userId)) {
      if (req.file) removeUploadedFile(req.file.filename);
      return renderSubmissionForm(res, eventWithMeta, {
        submissionError: 'Para salvar rascunho, faça login como autor no sistema.',
        formData
      });
    }

    const pdfPath = req.file ? req.file.filename : (existingDraft ? existingDraft.pdf_path : null);
    const fileOriginalName = req.file ? req.file.originalname : (existingDraft ? existingDraft.file_original_name : null);
    const errors = validateSubmission(formData, eventWithMeta, isDraft, pdfPath);

    if (errors.length > 0) {
      if (req.file && (!existingDraft || existingDraft.pdf_path !== req.file.filename)) {
        removeUploadedFile(req.file.filename);
      }
      return renderSubmissionForm(res, eventWithMeta, {
        submissionError: errors.join(' '),
        formData,
        currentFileName: existingDraft ? existingDraft.file_original_name : fileOriginalName,
        editingDraft: !!existingDraft
      });
    }

    const authors = formData.authors
      .filter((author) => author.name.trim() || author.email.trim() || author.institution.trim() || author.lattes.trim() || author.orcid.trim())
      .map((author, index) => ({ ...author, order: index + 1 }));

    const nextStatus = isDraft ? 'draft' : 'pending';
    const nextAccessCode = isDraft
      ? (existingDraft ? existingDraft.access_code : null)
      : ((existingDraft && existingDraft.access_code) || ('ACC-' + Math.random().toString(36).substr(2, 9).toUpperCase()));

    if (existingDraft) {
      if (req.file && existingDraft.pdf_path && existingDraft.pdf_path !== req.file.filename) {
        removeUploadedFile(existingDraft.pdf_path);
      }

      db.prepare(`
        UPDATE articles
        SET title = ?, title_en = ?, area = ?, authors = ?, authors_json = ?, abstract = ?, keywords = ?,
            pdf_path = ?, file_original_name = ?, contributor = ?, affiliation = ?, city = ?,
            email_submission = ?, submitter_user_id = ?, access_code = ?, type = ?, status = ?,
            funding = ?, blind_review_confirmed = ?, ethics_confirmed = ?, publication_authorized = ?,
            presentation_needs = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        formData.title.trim(),
        formData.title.trim(),
        formData.area,
        formatAuthorsForLegacyField(authors),
        serializeAuthors(authors),
        formData.abstract,
        formData.keywords,
        pdfPath,
        fileOriginalName,
        formData.contributor,
        formData.affiliation,
        formData.city,
        formData.email_submission,
        req.session ? req.session.userId : null,
        nextAccessCode,
        formData.type,
        nextStatus,
        formData.funding,
        formData.blind_review_confirmed ? 1 : 0,
        formData.ethics_confirmed ? 1 : 0,
        formData.publication_authorized ? 1 : 0,
        formData.presentation_needs,
        existingDraft.id
      ).run();
    } else {
      db.prepare(`
        INSERT INTO articles
        (event_id, title, title_en, area, authors, authors_json, abstract, keywords, pdf_path, file_original_name,
         contributor, affiliation, city, email_submission, submitter_user_id, access_code, type, status,
         funding, blind_review_confirmed, ethics_confirmed, publication_authorized, presentation_needs,
         date_submitted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
      `).bind(
        event.id,
        formData.title.trim(),
        formData.title.trim(),
        formData.area,
        formatAuthorsForLegacyField(authors),
        serializeAuthors(authors),
        formData.abstract,
        formData.keywords,
        pdfPath,
        fileOriginalName,
        formData.contributor,
        formData.affiliation,
        formData.city,
        formData.email_submission,
        req.session ? req.session.userId : null,
        nextAccessCode,
        formData.type,
        nextStatus,
        formData.funding,
        formData.blind_review_confirmed ? 1 : 0,
        formData.ethics_confirmed ? 1 : 0,
        formData.publication_authorized ? 1 : 0,
        formData.presentation_needs
      ).run();
    }

    if (isDraft) {
      return res.redirect('/author');
    }

    syncAuthorEventRegistration(event.id, req.session, formData);

    return renderSubmissionForm(res, eventWithMeta, {
      title: 'Submissão Concluída',
      submitted: true,
      access_code: nextAccessCode,
      formData: ensureAtLeastOneAuthor(normalizeFormData({}, req.session))
    });
  } catch (error) {
    console.error('Erro ao processar submissão pública:', error);
    if (req.file) removeUploadedFile(req.file.filename);

    const event = withAreaMeta(db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.eventId).get());
    if (!event) {
      return res.status(500).render('error', { title: 'Erro interno do servidor', message: 'Ocorreu um erro inesperado.' });
    }

    return renderSubmissionForm(res, withSubmissionMeta(event), {
      submissionError: 'Ocorreu um erro ao processar a submissão. Revise os dados e tente novamente.',
      formData: ensureAtLeastOneAuthor(normalizeFormData(req.body, req.session))
    });
  }
});

router.get('/author', requireNonAdminAuthorAccess, (req, res) => {
  const participantEvents = db.prepare(`
    SELECT *
    FROM events
    WHERE status = 'published'
    ORDER BY date_start DESC
  `).all().map((event) => withSubmissionMeta(withAreaMeta(event)));

  const submissions = db.prepare(`
    SELECT a.*, e.name as event_name, e.date_start, e.date_end
    FROM articles a
    JOIN events e ON e.id = a.event_id
    WHERE a.submitter_user_id = ?
       OR (a.submitter_user_id IS NULL AND a.email_submission = ?)
    ORDER BY a.created_at DESC
  `).bind(req.session.userId, req.session.userEmail).all().map((article) => ({
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
        ELSE 'Ouvinte inscrito'
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
  `).bind(req.session.userId, req.session.userEmail).all();

  const stats = {
    total: submissions.length,
    drafts: submissions.filter((item) => item.status === 'draft').length,
    pending: submissions.filter((item) => item.status === 'pending' || item.status === 'in_review').length,
    approved: submissions.filter((item) => item.status === 'approved').length,
    rejected: submissions.filter((item) => item.status === 'rejected').length
  };

  res.render('public/author-dashboard', {
    title: 'Área do Participante',
    participantEvents,
    participations,
    submissions,
    stats
  });
});

// Consultar artigo por código
router.get('/consultar', (req, res) => {
  res.render('public/consultar', { article: null, error: null, title: 'Consultar Artigo' });
});

router.post('/consultar', (req, res) => {
  const { access_code } = req.body;
  const article = db.prepare(`
    SELECT a.*, e.name as event_name
    FROM articles a
    JOIN events e ON a.event_id = e.id
    WHERE a.access_code = ?
      AND a.status != 'draft'
  `).bind(access_code).get();

  if (!article) {
    return res.render('public/consultar', { article: null, error: 'Código de acesso inválido.', title: 'Consultar Artigo' });
  }

  res.render('public/consultar', { article, error: null, title: 'Artigo Encontrado' });
});

// Página de revisores
router.get('/revisores', (req, res) => {
  const reviewers = db.prepare(`
    SELECT u.id, u.name, u.email, COUNT(DISTINCT a.id) as article_count
    FROM users u
    LEFT JOIN assignments ass ON ass.reviewer_id = u.id
    LEFT JOIN articles a ON a.id = ass.article_id AND a.status != 'draft'
    WHERE u.is_reviewer = 1 AND u.is_public = 1
    GROUP BY u.id
    ORDER BY u.name
  `).all();

  res.render('public/reviewers', { reviewers, areas: [], title: 'Corpo de Revisores' });
});

router.get('/cadastro', (req, res) => {
  res.render('public/register', {
    title: 'Solicitar Cadastro',
    error: null,
    success: null,
    formData: {}
  });
});

router.post('/cadastro', (req, res) => {
  const { name, email, password, confirm_password, cpf, passport, country, institution } = req.body;
  const formData = {
    name: name || '',
    email: email || '',
    cpf: cpf || '',
    passport: passport || '',
    country: country || '',
    institution: institution || ''
  };

  if (!name || !email || !password || !confirm_password) {
    return res.status(400).render('public/register', {
      title: 'Solicitar Cadastro',
      error: 'Nome, e-mail, senha e confirmação de senha são obrigatórios.',
      success: null,
      formData
    });
  }

  if (password !== confirm_password) {
    return res.status(400).render('public/register', {
      title: 'Solicitar Cadastro',
      error: 'As senhas não conferem.',
      success: null,
      formData
    });
  }

  if (password.length < 6) {
    return res.status(400).render('public/register', {
      title: 'Solicitar Cadastro',
      error: 'A senha deve ter pelo menos 6 caracteres.',
      success: null,
      formData
    });
  }

  const existing = db.prepare('SELECT id, approval_status FROM users WHERE email = ?').bind(email).get();
  if (existing) {
    return res.status(400).render('public/register', {
      title: 'Solicitar Cadastro',
      error: existing.approval_status === 'pending'
        ? 'Já existe uma solicitação de cadastro pendente para este e-mail.'
        : 'Já existe um usuário cadastrado com este e-mail.',
      success: null,
      formData
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (
      name, email, password, cpf, passport, country, institution,
      is_admin, is_reviewer, is_public, approval_status, approved_at,
      password_changed, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'pending', NULL, 1, datetime('now'), datetime('now'))
  `).bind(
    name,
    email,
    hash,
    cpf || null,
    passport || null,
    country || null,
    institution || null
  ).run();

  return res.render('public/register', {
    title: 'Solicitar Cadastro',
    error: null,
    success: 'Solicitação enviada com sucesso. Um administrador fará a validação do seu cadastro antes da liberação do acesso.',
    formData: {}
  });
});

module.exports = router;
