const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, recordParticipantAudit } = require('../db');
const bcrypt = require('bcryptjs');
const { renderCertificatePdf } = require('../services/certificates');
const { registrationLimiter } = require('../security/rate-limits');
const { validators: v, validateAndHandle } = require('../security/validation');
const { body } = require('express-validator');
const { getAreas, getCursosByArea, getCursosMap, NO_DEGREE_COURSE } = require('../services/academic-formation');

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

const registrationUpload = multer({
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

function runRegistrationUpload(req, res, next) {
  registrationUpload.fields([
    { name: 'academic_history_pdf', maxCount: 1 },
    { name: 'motivation_letter_pdf', maxCount: 1 },
    { name: 'recommendation_letter_pdf', maxCount: 1 }
  ])(req, res, (err) => {
    if (!err) return next();
    req.registrationUploadError = err.code === 'LIMIT_FILE_SIZE'
      ? 'Um dos arquivos de subsídio excede o limite de 10 MB.'
      : 'Falha no upload dos documentos de subsídio. Envie apenas arquivos PDF válidos.';
    return next();
  });
}

function getSubmissionWindow(event) {
  if (!event.has_article_submission) {
    return {
      isOpen: false,
      isConfigured: false,
      message: 'Este evento não recebe submissão de artigos.',
      start: null,
      end: null
    };
  }

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

function formatDisplayDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
}

function getEventStatus(event) {
  const now = new Date();
  const start = event.date_start ? new Date(`${event.date_start}T00:00:00`) : null;
  const end = event.date_end ? new Date(`${event.date_end}T23:59:59`) : start;

  if (!start) return 'A definir';
  if (now < start) return 'Programado';
  if (end && now > end) return 'Encerrado';
  return 'Em andamento';
}

function getRegistrationStatus(event) {
  const window = getRegistrationWindow(event);
  if (!window.isConfigured) return 'A definir';
  if (!window.isOpen) return window.start && new Date() < window.start ? 'Programada' : 'Encerrada';
  return 'Disponivel';
}

function getAnalysisStatus(event) {
  if (!event.has_article_submission) return null;
  const reviewStart = event.review_start ? new Date(`${event.review_start}T00:00:00`) : null;
  const reviewEnd = event.review_end ? new Date(`${event.review_end}T23:59:59`) : null;
  const now = new Date();

  if (!reviewStart || !reviewEnd) return 'A definir';
  if (now < reviewStart) return 'Programada';
  if (now > reviewEnd) return 'Encerrada';
  return 'Em análise';
}

function getStatusTone(status) {
  const value = String(status || '').toLowerCase();
  if (['aberta', 'disponivel', 'em andamento', 'em análise'].includes(value)) return 'status-positive';
  if (['programado', 'programada', 'aguardando submissões'].includes(value)) return 'status-neutral';
  if (['encerrada', 'encerrado', 'indisponivel'].includes(value)) return 'status-negative';
  return 'status-muted';
}

function getRegistrationWindow(event) {
  const now = new Date();
  const start = event.registration_start ? new Date(`${event.registration_start}T00:00:00`) : null;
  const end = event.registration_end ? new Date(`${event.registration_end}T23:59:59`) : null;

  if (!start || !end) {
    return {
      isOpen: false,
      isConfigured: false,
      message: 'Este evento não possui período de inscrições configurado.',
      start,
      end
    };
  }

  if (now < start) {
    return {
      isOpen: false,
      isConfigured: true,
      message: `As inscrições para este evento abrem em ${start.toLocaleDateString('pt-BR')}.`,
      start,
      end
    };
  }

  if (now > end) {
    return {
      isOpen: false,
      isConfigured: true,
      message: `O período de inscrições deste evento encerrou em ${end.toLocaleDateString('pt-BR')}.`,
      start,
      end
    };
  }

  return { isOpen: true, isConfigured: true, message: null, start, end };
}

function getCertificatesWindow(event) {
  const now = new Date();
  const start = event.certificates_start ? new Date(`${event.certificates_start}T00:00:00`) : null;
  const end = event.certificates_end ? new Date(`${event.certificates_end}T23:59:59`) : null;

  if (!start || !end) {
    return {
      isOpen: false,
      isConfigured: false,
      message: 'Este evento não possui período de certificados configurado.',
      start,
      end
    };
  }

  if (now < start) {
    return {
      isOpen: false,
      isConfigured: true,
      message: `Os certificados deste evento estarão disponíveis a partir de ${start.toLocaleDateString('pt-BR')}.`,
      start,
      end
    };
  }

  if (now > end) {
    return {
      isOpen: false,
      isConfigured: true,
      message: `O período para acesso aos certificados deste evento encerrou em ${end.toLocaleDateString('pt-BR')}.`,
      start,
      end
    };
  }

  return { isOpen: true, isConfigured: true, message: null, start, end };
}

function buildEventTimeline(event, options = {}) {
  const { registration = null, session = null } = options;
  const isAuthenticatedParticipant = !!(session && session.userId);
  const hasRegistration = !!registration;
  const registrationWindow = getRegistrationWindow(event);
  const certificatesWindow = getCertificatesWindow(event);
  const registrationStart = event.registration_start ? new Date(`${event.registration_start}T00:00:00`) : null;
  const registrationEnd = event.registration_end ? new Date(`${event.registration_end}T23:59:59`) : null;
  const submissionStart = event.submission_start ? new Date(`${event.submission_start}T00:00:00`) : null;
  const submissionEnd = event.submission_end ? new Date(`${event.submission_end}T23:59:59`) : null;
  const eventStart = event.date_start ? new Date(`${event.date_start}T00:00:00`) : null;
  const eventEnd = event.date_end ? new Date(`${event.date_end}T23:59:59`) : eventStart;
  const reviewStart = event.review_start ? new Date(`${event.review_start}T00:00:00`) : null;
  const reviewEnd = event.review_end ? new Date(`${event.review_end}T23:59:59`) : null;
  const certificatesStart = event.certificates_start ? new Date(`${event.certificates_start}T00:00:00`) : null;
  const certificatesEnd = event.certificates_end ? new Date(`${event.certificates_end}T23:59:59`) : null;

  const submissionStatus = event.submission.isOpen
    ? 'Aberta'
    : event.submission.isConfigured
      ? (submissionStart && new Date() < submissionStart ? 'Programada' : 'Encerrada')
      : 'Nao configurada';

  const timeline = [
    {
      label: 'Inscrições',
      startLabel: formatDisplayDate(registrationStart) || 'A definir',
      endLabel: formatDisplayDate(registrationEnd) || 'A definir',
      status: getRegistrationStatus(event)
    },
    {
      label: 'Evento',
      startLabel: formatDisplayDate(eventStart) || 'A definir',
      endLabel: formatDisplayDate(eventEnd) || 'A definir',
      status: getEventStatus(event)
    },
    {
      label: 'Certificados',
      startLabel: formatDisplayDate(certificatesStart) || 'A definir',
      endLabel: formatDisplayDate(certificatesEnd) || 'A definir',
      status: (!certificatesStart || !certificatesEnd)
        ? 'A definir'
        : (new Date() < certificatesStart ? 'Programada' : (new Date() > certificatesEnd ? 'Encerrada' : 'Disponivel'))
    }
  ];

  if (event.has_article_submission) {
    timeline.splice(1, 0,
      {
        label: 'Submissão Artigos',
        startLabel: formatDisplayDate(submissionStart) || 'A definir',
        endLabel: formatDisplayDate(submissionEnd) || 'A definir',
        status: submissionStatus
      },
      {
        label: 'Análise Submissão',
        startLabel: formatDisplayDate(reviewStart) || 'A definir',
        endLabel: formatDisplayDate(reviewEnd) || 'A definir',
        status: getAnalysisStatus(event)
      }
    );
  }

  return timeline.map((item) => ({
    ...item,
    statusTone: getStatusTone(item.status)
  })).map((item) => {
    if (item.label === 'Inscrições') {
      if (!registrationWindow.isConfigured) {
        return item;
      }

      if (hasRegistration) {
        return {
          ...item,
          actionLabel: 'Minhas participações',
          actionHref: '/author',
          actionTone: 'ghost'
        };
      }

      if (isAuthenticatedParticipant) {
        return {
          ...item,
          actionLabel: 'Inscrever-se',
          actionHref: `/evento/${event.id}/inscricao`,
          actionTone: registrationWindow.isOpen ? 'primary' : 'ghost'
        };
      }

      return {
        ...item,
        actionLabel: 'Entrar',
        actionHref: '/login',
        actionTone: 'ghost'
      };
    }

    if (item.label === 'Submissão Artigos') {
      if (!event.has_article_submission || !event.submission.isConfigured) {
        return item;
      }

      if (isAuthenticatedParticipant && hasRegistration) {
        return {
          ...item,
          actionLabel: 'Submeter Artigo',
          actionHref: `/submeter/${event.id}`,
          actionTone: item.status === 'Aberta' ? 'primary' : 'ghost'
        };
      }

      if (isAuthenticatedParticipant) {
        return {
          ...item,
          actionLabel: 'Inscrever-se',
          actionHref: `/evento/${event.id}/inscricao`,
          actionTone: 'ghost'
        };
      }

      return {
        ...item,
        actionLabel: 'Entrar',
        actionHref: '/login',
        actionTone: 'ghost'
      };
    }

    if (item.label === 'Evento' && event.url && String(event.url).trim()) {
      return {
        ...item,
        actionLabel: 'Acessar site',
        actionHref: event.url,
        actionTone: 'ghost',
        actionExternal: true
      };
    }

    if (item.label === 'Certificados' && !certificatesWindow.isConfigured) {
      return item;
    }

    if (item.label === 'Certificados' && session && session.userId && hasRegistration && certificatesWindow.isOpen) {
      return {
        ...item,
        actionLabel: 'Meus certificados',
        actionHref: `/evento/${event.id}/certificates`,
        actionTone: 'ghost'
      };
    }

    return item;
  });
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
      SET user_id = ?, name = ?, email = ?, institution = ?, registration_type = 'author', updated_at = datetime('now', '-3 hours')
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
    VALUES (?, ?, ?, ?, ?, 'author', datetime('now', '-3 hours'), datetime('now', '-3 hours'))
  `).run(
    eventId,
    session && session.userId ? session.userId : null,
    registrationName,
    normalizedEmail,
    registrationInstitution
  );
}

function normalizeListenerRegistrationForm(body = {}, session = null) {
  const subsidyRequested = body.subsidy_requested === '1' || body.subsidy_requested === 'on';
  const submittedActivities = Array.isArray(body.activity_ids) ? body.activity_ids : [body.activity_ids];

  return {
    name: String(body.name || (session && session.userName) || '').trim(),
    email: String(body.email || (session && session.userEmail) || '').trim().toLowerCase(),
    institution: String(body.institution || (session && session.userInstitution) || '').trim(),
    subsidy_requested: subsidyRequested,
    student_level: String(body.student_level || '').trim(),
    student_course: String(body.student_course || '').trim(),
    student_institution_name: String(body.student_institution_name || '').trim(),
    student_institution_state: String(body.student_institution_state || '').trim(),
    student_lattes_id: String(body.student_lattes_id || '').replace(/\D/g, ''),
    activity_ids: [...new Set(submittedActivities.map((id) => Number(id)).filter(Number.isInteger))]
  };
}

function getPublicEventActivities(eventId) {
  return db.prepare(`SELECT id,name,activity_type,activity_date,workload_hours,certificate_enabled
    FROM event_activities WHERE event_id=?
      AND instr(',' || replace(COALESCE(eligible_roles,''),' ','') || ',', ',participant,') > 0
    ORDER BY activity_date,name COLLATE NOCASE`).all(eventId);
}

function getRegistrationActivityIds(registrationId) {
  if (!registrationId) return [];
  return db.prepare('SELECT activity_id FROM participant_activity_enrollments WHERE registration_id=? ORDER BY activity_id')
    .all(registrationId).map((row) => Number(row.activity_id));
}

function validateRegistrationActivities(eventId, activityIds) {
  const activities = getPublicEventActivities(eventId);
  if (activities.length && !activityIds.length) return 'Selecione ao menos uma atividade para concluir a inscrição.';
  const allowed = new Set(activities.map((activity) => Number(activity.id)));
  if (activityIds.some((id) => !allowed.has(id))) return 'Uma das atividades selecionadas não está disponível para inscrição.';
  return null;
}

function saveRegistrationActivities(registrationId, userId, activityIds, actorUserId = userId) {
  db.prepare('DELETE FROM participant_activity_enrollments WHERE registration_id=?').run(registrationId);
  const insert = db.prepare(`INSERT INTO participant_activity_enrollments
    (activity_id,registration_id,user_id,enrolled_by,created_at,updated_at)
    VALUES(?,?,?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))`);
  activityIds.forEach((activityId) => insert.run(activityId, registrationId, userId, actorUserId));
}

function validateListenerRegistrationForm(formData, event, existingRegistration, uploadedFiles) {
  const errors = [];
  const registrationWindow = getRegistrationWindow(event);
  const hasAcademicHistory = !!(uploadedFiles.academic_history_pdf || (existingRegistration && existingRegistration.academic_history_pdf_path));
  const hasMotivationLetter = !!(uploadedFiles.motivation_letter_pdf || (existingRegistration && existingRegistration.motivation_letter_pdf_path));
  const hasRecommendationLetter = !!(uploadedFiles.recommendation_letter_pdf || (existingRegistration && existingRegistration.recommendation_letter_pdf_path));

  if (!registrationWindow.isOpen) {
    errors.push(registrationWindow.message || 'O período de inscrições deste evento está fechado.');
  }

  if (!formData.name || !formData.email) {
    errors.push('Nome e e-mail são obrigatórios para a inscrição no evento.');
  }
  const activityError = validateRegistrationActivities(event.id, formData.activity_ids || []);
  if (activityError) errors.push(activityError);

  if (event.offers_subsidy && formData.subsidy_requested) {
    if (!formData.student_level) errors.push('Selecione o nível do estudante para solicitar o subsídio.');
    if (!formData.student_course) errors.push('Informe o curso para solicitar o subsídio.');
    if (!formData.student_institution_name) errors.push('Informe o nome da instituição de ensino superior vinculada ao subsídio.');
    if (!formData.student_institution_state) errors.push('Informe a UF da instituição vinculada ao subsídio.');
    if (!/^\d{16}$/.test(formData.student_lattes_id)) errors.push('Informe o ID do Currículo Lattes com 16 dígitos numéricos.');
    if (!hasAcademicHistory) errors.push('Faça o upload do histórico escolar atualizado em PDF.');
    if (!hasMotivationLetter) errors.push('Faça o upload da carta de motivação em PDF.');
    if (!hasRecommendationLetter) errors.push('Faça o upload da carta de recomendação em PDF.');
  }

  return errors;
}

function getUploadedRegistrationFiles(req) {
  const files = req.files || {};
  const getFile = (field) => Array.isArray(files[field]) && files[field][0] ? files[field][0] : null;

  return {
    academic_history_pdf: getFile('academic_history_pdf'),
    motivation_letter_pdf: getFile('motivation_letter_pdf'),
    recommendation_letter_pdf: getFile('recommendation_letter_pdf')
  };
}

function removeUploadedRegistrationFiles(uploadedFiles) {
  Object.values(uploadedFiles || {}).forEach((file) => {
    if (file && file.filename) removeUploadedFile(file.filename);
  });
}

function buildRegistrationDocumentMeta(existingRegistration, uploadedFiles) {
  return {
    academic_history_pdf_path: uploadedFiles.academic_history_pdf ? uploadedFiles.academic_history_pdf.filename : (existingRegistration ? existingRegistration.academic_history_pdf_path || '' : ''),
    academic_history_original_name: uploadedFiles.academic_history_pdf ? uploadedFiles.academic_history_pdf.originalname : (existingRegistration ? existingRegistration.academic_history_original_name || '' : ''),
    motivation_letter_pdf_path: uploadedFiles.motivation_letter_pdf ? uploadedFiles.motivation_letter_pdf.filename : (existingRegistration ? existingRegistration.motivation_letter_pdf_path || '' : ''),
    motivation_letter_original_name: uploadedFiles.motivation_letter_pdf ? uploadedFiles.motivation_letter_pdf.originalname : (existingRegistration ? existingRegistration.motivation_letter_original_name || '' : ''),
    recommendation_letter_pdf_path: uploadedFiles.recommendation_letter_pdf ? uploadedFiles.recommendation_letter_pdf.filename : (existingRegistration ? existingRegistration.recommendation_letter_pdf_path || '' : ''),
    recommendation_letter_original_name: uploadedFiles.recommendation_letter_pdf ? uploadedFiles.recommendation_letter_pdf.originalname : (existingRegistration ? existingRegistration.recommendation_letter_original_name || '' : '')
  };
}

function getSubsidyStatusForRegistration(event, formData) {
  if (!(event.offers_subsidy && formData.subsidy_requested)) {
    return 'not_requested';
  }

  return 'pending';
}

function removeReplacedRegistrationFiles(existingRegistration, uploadedFiles) {
  if (!existingRegistration) return;
  if (uploadedFiles.academic_history_pdf && existingRegistration.academic_history_pdf_path) removeUploadedFile(existingRegistration.academic_history_pdf_path);
  if (uploadedFiles.motivation_letter_pdf && existingRegistration.motivation_letter_pdf_path) removeUploadedFile(existingRegistration.motivation_letter_pdf_path);
  if (uploadedFiles.recommendation_letter_pdf && existingRegistration.recommendation_letter_pdf_path) removeUploadedFile(existingRegistration.recommendation_letter_pdf_path);
}

function renderListenerRegistrationForm(res, event, options = {}) {
  const eventWithMeta = withSubmissionMeta(withAreaMeta(event));
  res.render('public/event-register', {
    event: eventWithMeta,
    title: options.title || `Inscrição no Evento - ${event.name}`,
    error: options.error || null,
    success: options.success || null,
    formData: options.formData || {},
    alreadyRegistered: !!options.alreadyRegistered,
    registrationType: options.registrationType || null,
    activities: getPublicEventActivities(event.id),
    registrationWindow: getRegistrationWindow(eventWithMeta)
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
    editingDraft: !!options.editingDraft,
    hasRegistration: !!options.hasRegistration
  });
}

function normalizeParticipantProfileForm(body = {}) {
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    institution: String(body.institution || '').trim(),
    cpf: String(body.cpf || '').trim(),
    passport: String(body.passport || '').trim(),
    country: String(body.country || '').trim(),
    phone: String(body.phone || '').trim(),
    formacao_area: String(body.formacao_area || '').trim(),
    formacao_curso: String(body.formacao_curso || '').trim(),
    formacao_titulacao: String(body.formacao_titulacao || '').trim(),
    formacao_status: String(body.formacao_status || '').trim()
  };
}

function renderParticipantProfile(res, { formData, error = null, success = null }) {
  res.render('public/participant-profile', {
    title: 'Meus Dados',
    error,
    success,
    formData,
    areas: getAreas(),
    cursosMap: getCursosMap(),
    noDegreeCourse: NO_DEGREE_COURSE
  });
}

function validateParticipantFormacao(formData) {
  if (!formData.formacao_area && !formData.formacao_curso && !formData.formacao_titulacao && !formData.formacao_status) {
    return null;
  }
  if (!formData.formacao_area || !formData.formacao_curso) {
    return 'Preencha todos os campos de formação acadêmica ou deixe a seção vazia.';
  }
  if (!getAreas().some((area) => area.codigo === formData.formacao_area)) {
    return 'A área de formação selecionada é inválida.';
  }
  if (!getCursosByArea(formData.formacao_area).includes(formData.formacao_curso)) {
    return 'O curso selecionado não pertence à área de formação informada.';
  }
  const noDegree = formData.formacao_curso === NO_DEGREE_COURSE;
  if (!noDegree) {
    if (!formData.formacao_titulacao || !formData.formacao_status) {
      return 'Preencha todos os campos de formação acadêmica ou deixe a seção vazia.';
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

function canCancelEventRegistration(dateStart) {
  if (!dateStart) return false;

  const eventStart = new Date(`${dateStart}T00:00:00`);
  if (Number.isNaN(eventStart.getTime())) return false;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return today < eventStart;
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
  const event = withAreaMeta(db.prepare("SELECT * FROM events WHERE id = ? AND status IN ('published', 'encerrado')").bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não existe ou não está publicado.' });

  let registration = null;
  if (req.session && req.session.userId) {
    registration = db.prepare(`
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
  }

  const eventWithMeta = withSubmissionMeta(event);
  const isClosed = event.status === 'encerrado';
  let timeline = buildEventTimeline(eventWithMeta, {
    registration,
    session: req.session
  });

  if (isClosed) {
    timeline = timeline.map((item) => {
      if (item.label === 'Inscrições' && !registration) {
        return { ...item, actionLabel: null, actionHref: null, actionTone: null };
      }
      if (item.label === 'Submissão Artigos') {
        return { ...item, actionLabel: null, actionHref: null, actionTone: null };
      }
      return item;
    });
  }

  res.render('public/event', {
    event: eventWithMeta,
    title: event.name,
    registration,
    timeline
  });
});

router.get('/evento/:id/certificates', requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ? AND status IN ('published', 'encerrado')").bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const certificatesWindow = getCertificatesWindow(event);
  if (!certificatesWindow.isOpen) {
    return res.render('public/event-certificates', {
      title: `Certificados - ${event.name}`,
      event,
      certificates: [],
      certificatesWindow,
      success: null,
      error: null
    });
  }
  const certificates = db.prepare(`
    SELECT ce.*, e.certificates_start, e.certificates_end, cb.file_path AS background_path
    FROM certificate_emissions ce
    JOIN events e ON e.id = ce.event_id
    LEFT JOIN certificate_backgrounds cb ON cb.id = ce.background_id
    WHERE ce.status = 'issued'
      AND ce.event_id = ?
      AND (ce.user_id = ? OR EXISTS (SELECT 1 FROM event_registrations er WHERE er.id=ce.registration_id AND (er.user_id = ? OR LOWER(TRIM(er.email)) = LOWER(TRIM(?)))))
    ORDER BY ce.issued_at DESC
  `).all(req.params.id, req.session.userId, req.session.userId, req.session.userEmail || '').map((certificate) => ({ ...certificate, window: getCertificatesWindow(certificate) }));
  res.render('public/event-certificates', {
    title: `Certificados - ${event.name}`,
    event,
    certificates,
    certificatesWindow,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/evento/:id/inscricao', requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const currentUser = db.prepare(`
    SELECT institution
    FROM users
    WHERE id = ?
  `).get(req.session.userId);

  const existingRegistration = db.prepare(`
    SELECT id, registration_type, subsidy_requested, student_level, student_course, student_institution_name, student_institution_state,
           student_lattes_id, academic_history_original_name, motivation_letter_original_name, recommendation_letter_original_name,
           academic_history_pdf_path, motivation_letter_pdf_path, recommendation_letter_pdf_path, name, email, institution
    FROM event_registrations
    WHERE event_id = ?
      AND (
        user_id = ?
        OR LOWER(TRIM(email)) = LOWER(TRIM(?))
      )
    ORDER BY id
    LIMIT 1
  `).get(req.params.id, req.session.userId, req.session.userEmail || '');

  const registrationWindow = getRegistrationWindow(event);

  return renderListenerRegistrationForm(res, event, {
    error: !registrationWindow.isOpen ? registrationWindow.message : null,
    formData: existingRegistration
      ? {
          name: existingRegistration.name || req.session.userName || '',
          email: existingRegistration.email || req.session.userEmail || '',
          institution: existingRegistration.institution || currentUser?.institution || '',
          subsidy_requested: !!existingRegistration.subsidy_requested,
          student_level: existingRegistration.student_level || '',
          student_course: existingRegistration.student_course || '',
          student_institution_name: existingRegistration.student_institution_name || '',
          student_institution_state: existingRegistration.student_institution_state || '',
          student_lattes_id: existingRegistration.student_lattes_id || '',
          academic_history_original_name: existingRegistration.academic_history_original_name || '',
          motivation_letter_original_name: existingRegistration.motivation_letter_original_name || '',
          recommendation_letter_original_name: existingRegistration.recommendation_letter_original_name || '',
          activity_ids: getRegistrationActivityIds(existingRegistration.id)
        }
      : normalizeListenerRegistrationForm({}, req.session),
    alreadyRegistered: !!existingRegistration,
    registrationType: existingRegistration ? existingRegistration.registration_type : null,
    success: existingRegistration
      ? existingRegistration.registration_type === 'author'
        ? 'Você já está inscrito neste evento como apresentador.'
        : 'Você já está inscrito.'
      : null
  });
});

router.post('/evento/:id/inscricao', registrationLimiter, requireNonAdminAuthorAccess, runRegistrationUpload, (req, res, next) => {
  validateAndHandle(req, res, next, v.eventRegistration);
}, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const formData = normalizeListenerRegistrationForm(req.body, req.session);
  const uploadedFiles = getUploadedRegistrationFiles(req);

  const existingRegistration = db.prepare(`
    SELECT id, registration_type, academic_history_pdf_path, academic_history_original_name,
           motivation_letter_pdf_path, motivation_letter_original_name,
           recommendation_letter_pdf_path, recommendation_letter_original_name
    FROM event_registrations
    WHERE event_id = ?
      AND (
        user_id = ?
        OR LOWER(TRIM(email)) = LOWER(TRIM(?))
      )
    ORDER BY id
    LIMIT 1
  `).get(req.params.id, req.session.userId, req.session.userEmail || '');

  const registrationWindow = getRegistrationWindow(event);

  if (!registrationWindow.isOpen) {
    removeUploadedRegistrationFiles(uploadedFiles);
    return renderListenerRegistrationForm(res, event, {
      error: registrationWindow.message,
      formData: {
        ...formData,
        academic_history_original_name: existingRegistration ? existingRegistration.academic_history_original_name || '' : '',
        motivation_letter_original_name: existingRegistration ? existingRegistration.motivation_letter_original_name || '' : '',
        recommendation_letter_original_name: existingRegistration ? existingRegistration.recommendation_letter_original_name || '' : ''
      },
      alreadyRegistered: !!existingRegistration,
      registrationType: existingRegistration ? existingRegistration.registration_type : null
    });
  }

  if (req.registrationUploadError) {
    removeUploadedRegistrationFiles(uploadedFiles);
    return renderListenerRegistrationForm(res, event, {
      error: req.registrationUploadError,
      formData: {
        ...formData,
        academic_history_original_name: existingRegistration ? existingRegistration.academic_history_original_name || '' : '',
        motivation_letter_original_name: existingRegistration ? existingRegistration.motivation_letter_original_name || '' : '',
        recommendation_letter_original_name: existingRegistration ? existingRegistration.recommendation_letter_original_name || '' : ''
      },
      alreadyRegistered: !!existingRegistration,
      registrationType: existingRegistration ? existingRegistration.registration_type : null
    });
  }

  const errors = validateListenerRegistrationForm(formData, event, existingRegistration, uploadedFiles);

  if (errors.length > 0) {
    removeUploadedRegistrationFiles(uploadedFiles);
    return renderListenerRegistrationForm(res, event, {
      error: errors.join(' '),
      formData: {
        ...formData,
        academic_history_original_name: existingRegistration ? existingRegistration.academic_history_original_name || '' : '',
        motivation_letter_original_name: existingRegistration ? existingRegistration.motivation_letter_original_name || '' : '',
        recommendation_letter_original_name: existingRegistration ? existingRegistration.recommendation_letter_original_name || '' : ''
      },
      alreadyRegistered: !!existingRegistration,
      registrationType: existingRegistration ? existingRegistration.registration_type : null
    });
  }

  const documentMeta = buildRegistrationDocumentMeta(existingRegistration, uploadedFiles);

  if (existingRegistration) {
    const nextType = existingRegistration.registration_type === 'author' ? 'author' : 'listener';
    removeReplacedRegistrationFiles(existingRegistration, uploadedFiles);
    db.prepare(`
      UPDATE event_registrations
      SET name = ?, email = ?, institution = ?, subsidy_requested = ?, student_level = ?, student_course = ?,
          student_institution_name = ?, student_institution_state = ?, student_lattes_id = ?,
          subsidy_status = ?, subsidy_review_notes = CASE WHEN ? = 'pending' THEN '' ELSE subsidy_review_notes END,
          subsidy_reviewed_at = CASE WHEN ? = 'pending' THEN NULL ELSE subsidy_reviewed_at END,
          subsidy_reviewed_by = CASE WHEN ? = 'pending' THEN NULL ELSE subsidy_reviewed_by END,
          academic_history_pdf_path = ?, academic_history_original_name = ?,
          motivation_letter_pdf_path = ?, motivation_letter_original_name = ?,
          recommendation_letter_pdf_path = ?, recommendation_letter_original_name = ?,
          updated_at = datetime('now', '-3 hours')
      WHERE id = ?
    `).run(
      formData.name,
      formData.email,
      formData.institution,
      event.offers_subsidy && formData.subsidy_requested ? 1 : 0,
      event.offers_subsidy && formData.subsidy_requested ? formData.student_level : '',
      event.offers_subsidy && formData.subsidy_requested ? formData.student_course : '',
      event.offers_subsidy && formData.subsidy_requested ? formData.student_institution_name : '',
      event.offers_subsidy && formData.subsidy_requested ? formData.student_institution_state : '',
      event.offers_subsidy && formData.subsidy_requested ? formData.student_lattes_id : '',
      getSubsidyStatusForRegistration(event, formData),
      getSubsidyStatusForRegistration(event, formData),
      getSubsidyStatusForRegistration(event, formData),
      getSubsidyStatusForRegistration(event, formData),
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.academic_history_pdf_path : '',
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.academic_history_original_name : '',
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.motivation_letter_pdf_path : '',
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.motivation_letter_original_name : '',
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.recommendation_letter_pdf_path : '',
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.recommendation_letter_original_name : '',
      existingRegistration.id
    );
    saveRegistrationActivities(existingRegistration.id, req.session.userId, formData.activity_ids);
    recordParticipantAudit({
      eventId: event.id, registrationId: existingRegistration.id, actorUserId: req.session.userId,
      action: 'participant_activities_updated_self_service', details: { activity_ids: formData.activity_ids }
    });

    return renderListenerRegistrationForm(res, event, {
      success: nextType === 'author'
        ? 'Sua participação já estava registrada como apresentador neste evento.'
        : 'Sua inscrição como participante já estava registrada neste evento.',
      formData: {
        ...formData,
        academic_history_original_name: event.offers_subsidy && formData.subsidy_requested ? documentMeta.academic_history_original_name : '',
        motivation_letter_original_name: event.offers_subsidy && formData.subsidy_requested ? documentMeta.motivation_letter_original_name : '',
        recommendation_letter_original_name: event.offers_subsidy && formData.subsidy_requested ? documentMeta.recommendation_letter_original_name : ''
      },
      alreadyRegistered: true,
      registrationType: nextType
    });
  }

  const registrationResult = db.prepare(`
    INSERT INTO event_registrations (
      event_id, user_id, name, email, institution, registration_type, subsidy_requested, student_level,
      student_course, student_institution_name, student_institution_state, student_lattes_id, subsidy_status,
      academic_history_pdf_path, academic_history_original_name,
      motivation_letter_pdf_path, motivation_letter_original_name,
      recommendation_letter_pdf_path, recommendation_letter_original_name,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'listener', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
  `).run(
    event.id,
    req.session.userId,
    formData.name,
    formData.email,
    formData.institution,
    event.offers_subsidy && formData.subsidy_requested ? 1 : 0,
    event.offers_subsidy && formData.subsidy_requested ? formData.student_level : '',
    event.offers_subsidy && formData.subsidy_requested ? formData.student_course : '',
    event.offers_subsidy && formData.subsidy_requested ? formData.student_institution_name : '',
    event.offers_subsidy && formData.subsidy_requested ? formData.student_institution_state : '',
    event.offers_subsidy && formData.subsidy_requested ? formData.student_lattes_id : '',
    getSubsidyStatusForRegistration(event, formData),
    event.offers_subsidy && formData.subsidy_requested ? documentMeta.academic_history_pdf_path : '',
    event.offers_subsidy && formData.subsidy_requested ? documentMeta.academic_history_original_name : '',
    event.offers_subsidy && formData.subsidy_requested ? documentMeta.motivation_letter_pdf_path : '',
    event.offers_subsidy && formData.subsidy_requested ? documentMeta.motivation_letter_original_name : '',
    event.offers_subsidy && formData.subsidy_requested ? documentMeta.recommendation_letter_pdf_path : '',
      event.offers_subsidy && formData.subsidy_requested ? documentMeta.recommendation_letter_original_name : ''
  );
  saveRegistrationActivities(registrationResult.lastInsertRowid, req.session.userId, formData.activity_ids);
  recordParticipantAudit({
    eventId: event.id, registrationId: registrationResult.lastInsertRowid, actorUserId: req.session.userId,
    action: 'participant_activities_selected_on_registration', details: { activity_ids: formData.activity_ids }
  });
  db.prepare("UPDATE users SET is_participant=1, updated_at=datetime('now','-3 hours') WHERE id=?").run(req.session.userId);

  return renderListenerRegistrationForm(res, event, {
    success: 'Inscrição realizada com sucesso.',
      formData: {
        ...formData,
        academic_history_original_name: event.offers_subsidy && formData.subsidy_requested ? documentMeta.academic_history_original_name : '',
      motivation_letter_original_name: event.offers_subsidy && formData.subsidy_requested ? documentMeta.motivation_letter_original_name : '',
      recommendation_letter_original_name: event.offers_subsidy && formData.subsidy_requested ? documentMeta.recommendation_letter_original_name : ''
    },
    alreadyRegistered: true,
    registrationType: 'listener'
  });
});

function getOwnedEventRegistration(eventId, req) {
  return db.prepare(`SELECT * FROM event_registrations WHERE event_id=?
    AND (user_id=? OR LOWER(TRIM(email))=LOWER(TRIM(?))) ORDER BY id LIMIT 1`)
    .get(eventId, req.session.userId, req.session.userEmail || '');
}

router.get('/evento/:id/atividades', requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id=? AND status='published'").get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const registration = getOwnedEventRegistration(event.id, req);
  if (!registration) return res.redirect(`/evento/${event.id}/inscricao`);
  const activities = db.prepare(`SELECT ea.*,
      CASE WHEN pae.id IS NULL THEN 0 ELSE 1 END AS enrolled,
      CASE WHEN aar.id IS NULL THEN 0 ELSE 1 END AS present
    FROM event_activities ea
    LEFT JOIN participant_activity_enrollments pae ON pae.activity_id=ea.id AND pae.registration_id=?
    LEFT JOIN activity_attendance_records aar ON aar.activity_id=ea.id AND aar.user_id=? AND aar.role='participant'
    WHERE ea.event_id=?
      AND instr(',' || replace(COALESCE(ea.eligible_roles,''),' ','') || ',', ',participant,') > 0
    ORDER BY ea.activity_date,ea.name COLLATE NOCASE`).all(registration.id, req.session.userId, event.id);
  return res.render('public/event-activities', {
    title: `Minhas atividades - ${event.name}`, event: withAreaMeta(event), registration, activities,
    success: req.query.success || null, error: req.query.error || null
  });
});

router.post('/evento/:id/atividades', registrationLimiter, requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id=? AND status='published'").get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const registration = getOwnedEventRegistration(event.id, req);
  if (!registration) return res.redirect(`/evento/${event.id}/inscricao`);
  const submitted = Array.isArray(req.body.activity_ids) ? req.body.activity_ids : [req.body.activity_ids];
  const activityIds = [...new Set(submitted.map((id) => Number(id)).filter(Number.isInteger))];
  const validationError = validateRegistrationActivities(event.id, activityIds);
  if (validationError) return res.redirect(`/evento/${event.id}/atividades?error=${encodeURIComponent(validationError)}`);
  const attendedIds = db.prepare(`SELECT activity_id FROM activity_attendance_records
    WHERE user_id=? AND role='participant' AND activity_id IN (SELECT id FROM event_activities WHERE event_id=?)`)
    .all(req.session.userId, event.id).map((row) => Number(row.activity_id));
  const removingAttended = attendedIds.some((id) => !activityIds.includes(id));
  if (removingAttended) {
    return res.redirect(`/evento/${event.id}/atividades?error=${encodeURIComponent('Não é possível remover uma atividade que já possui presença registrada.')}`);
  }
  db.transaction(() => {
    saveRegistrationActivities(registration.id, req.session.userId, activityIds);
    recordParticipantAudit({
      eventId: event.id, registrationId: registration.id, actorUserId: req.session.userId,
      action: 'participant_activities_updated_self_service', details: { activity_ids: activityIds }
    });
  })();
  return res.redirect(`/evento/${event.id}/atividades?success=${encodeURIComponent('Inscrição nas atividades atualizada.')}`);
});

// Formulário de submissão
router.get('/submeter/:eventId', requireNonAdminAuthorAccess, (req, res) => {
  const event = withAreaMeta(db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").bind(req.params.eventId).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const eventWithMeta = withSubmissionMeta(event);
  const registration = db.prepare(`
    SELECT id, registration_type
    FROM event_registrations
    WHERE event_id = ?
      AND (
        user_id = ?
        OR LOWER(TRIM(email)) = LOWER(TRIM(?))
      )
    ORDER BY id
    LIMIT 1
  `).get(req.params.eventId, req.session.userId, req.session.userEmail || '');
  const draft = getDraftForEditing(req.query.draftId, event.id, req);
  const formData = draft
    ? buildFormDataFromDraft(draft, req.session)
    : ensureAtLeastOneAuthor(normalizeFormData({}, req.session));

  if (!registration) {
    return renderSubmissionForm(res, eventWithMeta, {
      submissionError: 'Para submeter artigo, você precisa estar inscrito neste evento.',
      formData,
      currentFileName: null,
      hasRegistration: false
    });
  }

  if (!eventWithMeta.submission.isOpen && !draft) {
    return renderSubmissionForm(res, eventWithMeta, {
      submissionError: eventWithMeta.submission.message,
      formData,
      currentFileName: null,
      hasRegistration: true
    });
  }

  return renderSubmissionForm(res, eventWithMeta, {
    formData,
    currentFileName: draft ? draft.file_original_name : null,
    editingDraft: !!draft,
    successMessage: draft ? 'Rascunho carregado. Você pode continuar a edição e submeter quando estiver pronto.' : null,
    hasRegistration: true
  });
});

// Processar submissão de artigo
router.post('/submeter/:eventId', registrationLimiter, requireNonAdminAuthorAccess, runUpload, (req, res, next) => {
  validateAndHandle(req, res, next, v.submit);
}, (req, res) => {
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
    const registration = db.prepare(`
      SELECT id, registration_type
      FROM event_registrations
      WHERE event_id = ?
        AND (
          user_id = ?
          OR LOWER(TRIM(email)) = LOWER(TRIM(?))
        )
      ORDER BY id
      LIMIT 1
    `).get(req.params.eventId, req.session.userId, req.session.userEmail || '');

    if (req.uploadError) {
      if (req.file) removeUploadedFile(req.file.filename);
      return renderSubmissionForm(res, eventWithMeta, {
        submissionError: req.uploadError,
        formData,
        currentFileName: existingDraft ? existingDraft.file_original_name : null,
        editingDraft: !!existingDraft,
        hasRegistration: !!registration
      });
    }

    if (isDraft && (!req.session || !req.session.userId)) {
      if (req.file) removeUploadedFile(req.file.filename);
      return renderSubmissionForm(res, eventWithMeta, {
        submissionError: 'Para salvar rascunho, faça login como autor no sistema.',
        formData,
        hasRegistration: !!registration
      });
    }

    if (!registration && !isDraft) {
      if (req.file) removeUploadedFile(req.file.filename);
      return renderSubmissionForm(res, eventWithMeta, {
        submissionError: 'Para submeter artigo, você precisa estar inscrito neste evento.',
        formData,
        currentFileName: existingDraft ? existingDraft.file_original_name : null,
        editingDraft: !!existingDraft,
        hasRegistration: false
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
        editingDraft: !!existingDraft,
        hasRegistration: true
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
            presentation_needs = ?, updated_at = datetime('now', '-3 hours')
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'), datetime('now', '-3 hours'))
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
      return res.redirect('/author?success=Rascunho salvo com sucesso.');
    }

    syncAuthorEventRegistration(event.id, req.session, formData);

    return renderSubmissionForm(res, eventWithMeta, {
      title: 'Submissão Concluída',
      submitted: true,
      access_code: nextAccessCode,
      formData: ensureAtLeastOneAuthor(normalizeFormData({}, req.session)),
      hasRegistration: true
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
      formData: ensureAtLeastOneAuthor(normalizeFormData(req.body, req.session)),
      hasRegistration: true
    });
  }
});

router.get('/author', requireNonAdminAuthorAccess, (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const participationKeys = db.prepare(`
    SELECT DISTINCT event_id
    FROM event_registrations
    WHERE user_id = ?
       OR LOWER(TRIM(email)) = LOWER(TRIM(?))
  `).bind(req.session.userId, req.session.userEmail).all();

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
       OR (
         a.submitter_user_id IS NULL
         AND LOWER(TRIM(COALESCE(a.email_submission, ''))) = LOWER(TRIM(?))
       )
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
  `).bind(req.session.userId, req.session.userEmail).all();

  const participationsWithMeta = participations.map((participation) => ({
    ...participation,
    can_cancel: participation.registration_type === 'listener' && canCancelEventRegistration(participation.date_start)
  }));

  const showSubsidyStatus = participationsWithMeta.some((p) => !!p.subsidy_requested);

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
    participations: participationsWithMeta,
    submissions,
    stats,
    previewMode: false,
    previewUser: null,
    showSubsidyStatus: showSubsidyStatus,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/author/certificates', requireNonAdminAuthorAccess, (req, res) => {
  return res.redirect('/author');
});

router.get('/author/certificates/:id/download', requireNonAdminAuthorAccess, (req, res) => {
  const certificate = db.prepare(`
    SELECT ce.*, e.certificates_start, e.certificates_end, cb.file_path AS background_path
    FROM certificate_emissions ce
    JOIN events e ON e.id = ce.event_id
    LEFT JOIN certificate_backgrounds cb ON cb.id = ce.background_id
    WHERE ce.id = ? AND ce.status = 'issued'
      AND (ce.user_id = ? OR EXISTS (SELECT 1 FROM event_registrations er WHERE er.id=ce.registration_id AND (er.user_id = ? OR LOWER(TRIM(er.email)) = LOWER(TRIM(?)))))
  `).get(req.params.id, req.session.userId, req.session.userId, req.session.userEmail || '');
  if (!certificate) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  if (!getCertificatesWindow(certificate).isOpen) return res.status(403).render('error', { title: 'Certificado indisponível', message: getCertificatesWindow(certificate).message });
  res.type('application/pdf'); res.attachment(`certificado-${certificate.certificate_code}.pdf`); renderCertificatePdf(res, certificate);
});

router.post('/author/drafts/:id/delete', registrationLimiter, requireNonAdminAuthorAccess, (req, res) => {
  const draft = db.prepare(`
    SELECT id, pdf_path
    FROM articles
    WHERE id = ?
      AND status = 'draft'
      AND (
        submitter_user_id = ?
        OR (
          submitter_user_id IS NULL
          AND LOWER(TRIM(COALESCE(email_submission, ''))) = LOWER(TRIM(?))
        )
      )
    LIMIT 1
  `).get(req.params.id, req.session.userId, req.session.userEmail || '');

  if (!draft) {
    const wantsJson = (req.get('accept') || '').includes('application/json');
    if (wantsJson) {
      return res.status(404).json({ success: false, error: 'Rascunho não encontrado ou sem permissão para exclusão.' });
    }
    return res.redirect('/author?error=Rascunho não encontrado ou sem permissão para exclusão.');
  }

  if (draft.pdf_path) {
    removeUploadedFile(draft.pdf_path);
  }

  db.prepare('DELETE FROM articles WHERE id = ?').run(draft.id);

  const wantsJson = (req.get('accept') || '').includes('application/json');
  if (wantsJson) {
    return res.json({ success: true, deletedDraftId: draft.id });
  }

  return res.redirect('/author?success=Rascunho apagado com sucesso.');
});

router.post('/evento/:id/inscricao/cancelar', registrationLimiter, requireNonAdminAuthorAccess, (req, res) => {
  const event = db.prepare(`
    SELECT id, name, date_start
    FROM events
    WHERE id = ?
    LIMIT 1
  `).get(req.params.id);

  if (!event) {
    return res.redirect('/author?error=Evento não encontrado');
  }

  const registration = db.prepare(`
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

  if (!registration) {
    return res.redirect('/author?error=Inscrição não encontrada para este evento');
  }

  if (registration.registration_type !== 'listener') {
    return res.redirect('/author?error=Apenas inscrições de participantes sem artigo podem ser canceladas por esta área');
  }

  if (!canCancelEventRegistration(event.date_start)) {
    return res.redirect('/author?error=O prazo para cancelamento desta inscrição já foi encerrado');
  }

  db.prepare('DELETE FROM event_registrations WHERE id = ?').run(registration.id);

  return res.redirect('/author?success=Inscrição cancelada com sucesso');
});

router.get('/author/profile', requireNonAdminAuthorAccess, (req, res) => {
  const user = db.prepare(`
    SELECT id, name, email, institution, phone, cpf, passport, country,
           formacao_area, formacao_curso, formacao_titulacao, formacao_status
    FROM users
    WHERE id = ?
  `).get(req.session.userId);

  if (!user) {
    return res.status(404).render('error', {
      title: 'Usuário não encontrado',
      message: 'Não foi possível localizar os dados do usuário autenticado.'
    });
  }

  return renderParticipantProfile(res, { formData: user });
});

router.post('/author/profile', registrationLimiter, requireNonAdminAuthorAccess, (req, res, next) => {
  validateAndHandle(req, res, next, v.participantProfile);
}, (req, res) => {
  const formData = normalizeParticipantProfileForm(req.body);

  if (!formData.name || !formData.email) {
    return renderParticipantProfile(res, { formData, error: 'Nome e e-mail são obrigatórios.' });
  }

  if (!isValidCPF(formData.cpf)) {
    return renderParticipantProfile(res, { formData, error: 'O CPF informado é inválido.' });
  }

  const formacaoError = validateParticipantFormacao(formData);
  if (formacaoError) {
    return renderParticipantProfile(res, { formData, error: formacaoError });
  }
  if (formData.formacao_curso === NO_DEGREE_COURSE) {
    formData.formacao_titulacao = '';
    formData.formacao_status = '';
  }

  const emailOwner = db.prepare(`
    SELECT id
    FROM users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
      AND id != ?
      LIMIT 1
  `).get(formData.email, req.session.userId);

  if (emailOwner) {
    return renderParticipantProfile(res, { formData, error: 'Já existe outro usuário cadastrado com este e-mail.' });
  }

  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  let passwordHash = null;

  if (currentPassword || newPassword || confirmPassword) {
    const credentials = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.userId);
    if (!credentials || !bcrypt.compareSync(currentPassword, credentials.password)) {
      return renderParticipantProfile(res, { formData, error: 'A senha atual informada está incorreta.' });
    }
    if (!newPassword) {
      return renderParticipantProfile(res, { formData, error: 'Informe a nova senha para concluir a alteração.' });
    }
    if (newPassword !== confirmPassword) {
      return renderParticipantProfile(res, { formData, error: 'As senhas não conferem.' });
    }
    passwordHash = bcrypt.hashSync(newPassword, 10);
  }

  const baseParams = [
    formData.name,
    formData.email,
    formData.institution || null,
    normalizeCPF(formData.cpf) || null,
    formData.passport || null,
    formData.country || null,
    formData.phone || '',
    formData.formacao_area || null,
    formData.formacao_curso || null,
    formData.formacao_titulacao || null,
    formData.formacao_status || null
  ];

  if (passwordHash) {
    db.prepare(`
      UPDATE users
      SET name = ?, email = ?, institution = ?, cpf = ?, passport = ?, country = ?, phone = ?,
          formacao_area = ?, formacao_curso = ?, formacao_titulacao = ?, formacao_status = ?,
          password = ?, password_changed = 1, updated_at = datetime('now', '-3 hours')
      WHERE id = ?
    `).run(...baseParams, passwordHash, req.session.userId);
  } else {
    db.prepare(`
      UPDATE users
      SET name = ?, email = ?, institution = ?, cpf = ?, passport = ?, country = ?, phone = ?,
          formacao_area = ?, formacao_curso = ?, formacao_titulacao = ?, formacao_status = ?,
          updated_at = datetime('now', '-3 hours')
      WHERE id = ?
    `).run(...baseParams, req.session.userId);
  }

  req.session.userName = formData.name;
  req.session.userEmail = formData.email;
  req.session.userInstitution = formData.institution || '';

  const success = passwordHash
    ? 'Seus dados e sua senha foram atualizados com sucesso.'
    : 'Seus dados foram atualizados com sucesso.';

  return renderParticipantProfile(res, { formData, success });
});

// Consultar artigo por código
router.get('/consultar', (req, res) => {
  res.render('public/consultar', { article: null, error: null, title: 'Consultar Artigo' });
});

router.post('/consultar', (req, res, next) => {
  validateAndHandle(req, res, next, v.articleCode);
}, (req, res) => {
  const access_code = String(req.body.access_code || '').trim();
  const article = db.prepare(`
    SELECT
      a.*,
      e.name as event_name,
      COUNT(DISTINCT rp.id) as report_count,
      COALESCE(SUM(CASE WHEN rp.recommendation = 'approved' THEN 1 ELSE 0 END), 0) as approval_count,
      COALESCE(SUM(CASE WHEN rp.recommendation = 'rejected' THEN 1 ELSE 0 END), 0) as rejection_count,
      COALESCE(SUM(CASE WHEN rp.recommendation = 'revision_requested' THEN 1 ELSE 0 END), 0) as revision_count
    FROM articles a
    JOIN events e ON a.event_id = e.id
    LEFT JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE a.access_code = ?
      AND a.status != 'draft'
    GROUP BY a.id, e.name
  `).bind(access_code).get();

  if (!article) {
    return res.render('public/consultar', { article: null, error: 'Código de acesso inválido.', title: 'Consultar Artigo' });
  }

  res.render('public/consultar', { article, error: null, title: 'Artigo Encontrado' });
});

// Consultar certificado por código
router.get('/consultar-certificado', (req, res) => {
  res.render('public/certificado-consulta', { certificate: null, error: null, codePrefill: req.query.code || null, title: 'Verificar Certificado' });
});

router.post('/consultar-certificado', (req, res, next) => {
  validateAndHandle(req, res, next, v.certificateCode);
}, (req, res) => {
  const certificate_code = String(req.body.certificate_code || '').trim();
  const certificate = db.prepare(`
    SELECT
      ce.*,
      e.name as event_name,
      e.date_start as event_date_start,
      e.date_end as event_date_end,
      cb.file_path AS background_path,
      u.name as user_name
    FROM certificate_emissions ce
    JOIN events e ON e.id = ce.event_id
    LEFT JOIN certificate_backgrounds cb ON cb.id = ce.background_id
    LEFT JOIN users u ON u.id = ce.user_id
    WHERE ce.certificate_code = ?
  `).bind(certificate_code).get();

  if (!certificate) {
    return res.render('public/certificado-consulta', { certificate: null, error: 'Código de certificado inválido ou não encontrado.', codePrefill: certificate_code, title: 'Verificar Certificado' });
  }

  const roleLabels = { participant: 'Participante', reviewer: 'Revisor', speaker: 'Palestrante', teacher: 'Professor', oral_presenter: 'Apresentador Oral', poster_presenter: 'Apresentador Pôster' };
  certificate.role_label = roleLabels[certificate.certificate_role] || 'Participante';

  res.render('public/certificado-consulta', { certificate, error: null, codePrefill: certificate_code, title: 'Certificado Verificado' });
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

router.post('/cadastro', registrationLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, [
    ...v.registration,
    body('password').isLength({ min: 8 }).withMessage('A senha deve ter pelo menos 8 caracteres.'),
    body('password').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('A senha deve conter maiúscula, minúscula e número.'),
    body('confirm_password').custom((value, { req: r }) => {
      if (value !== r.body.password) throw new Error('As senhas não conferem.');
      return true;
    })
  ]);
}, (req, res) => {
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
      password_changed, profile_completed, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'pending', NULL, 1, 0, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
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
