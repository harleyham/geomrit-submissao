const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { readFirstSheetRows } = require('../services/sheet-reader');
const { validateCsrfToken } = require('../security/csrf');
const archiver = require('archiver');
const { db, recordParticipantAudit } = require('../db');
const { renderCertificatePdf, getBackgroundPath } = require('../services/certificates');
const { ensureEventQrToken, getEventQrRoles, renderCrachaPdf } = require('../services/cracha');
const { removeEventLogoFile, drawEventLogo } = require('../services/event-logo');
const { getAreas, getCursosMap, NO_DEGREE_COURSE } = require('../services/academic-formation');
const { getSystemEmailSettings, getPendingEmailCount, setEventEmailEnabled, queueCertificateIssued,
  queueVideoLinkNotifications, isValidHttpUrl, createImportBatch, getImportBatchEmailSummary,
  authorizeImportBatch, queueImportedAccount, queueImportedRegistration, queueRegistrationReviewDecision, queueParticipantActivitiesUpdated } = require('../services/email');
const { strictLimiter } = require('../security/rate-limits');
const { validateAndHandle, validators: v } = require('../security/validation');

function safeArchiveFileName(value, fallback) {
  const normalized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function roleLabel(role) {
  const meta = CERTIFICATE_ROLES[role];
  return meta ? meta.label : role;
}

function detectDelimiter(firstLine) {
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (semiCount > commaCount) return ';';
  return ',';
}

function parseCsvContent(content, delimiter) {
  const headers = [];
  const rows = [];
  let pos = 0;
  const len = content.length;

  const detectedDelimiter = delimiter || detectDelimiter(content.split('\n')[0].split('\r')[0]);

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
          if (pos + 1 < len && content[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            inQuotes = false;
            pos++;
          }
        } else {
          field += ch;
          pos++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          pos++;
        } else if (ch === detectedDelimiter) {
          return field;
        } else if (ch === '\r' || ch === '\n') {
          return field;
        } else {
          field += ch;
          pos++;
        }
      }
    }
    return field;
  };

  const readLine = () => {
    if (pos >= len) return null;
    const line = [];
    line.push(readField());
    while (pos < len && content[pos] === detectedDelimiter) {
      pos++;
      line.push(readField());
    }
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
    headers.forEach((h, idx) => {
      obj[h] = (idx < line.length ? line[idx] : '').trim();
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  }

  return { headers, rows };
}

function generateCertificateBuffer(certificate) {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
      const chunks = [];
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
      const { width, height } = document.page;
      const backgroundPath = getBackgroundPath(certificate.background_path);
      if (backgroundPath && fs.existsSync(backgroundPath)) {
        document.image(backgroundPath, 0, 0, { width, height });
      } else {
        document.rect(0, 0, width, height).fill('#ffffff');
      }
      const textColor = certificate.text_color || '#0f172a';
      const certificateTitle = certificate.certificate_title || 'CERTIFICADO DE PARTICIPAÇÃO';
      let certificateBody = certificate.certificate_body || `participou do evento ${certificate.event_name}.`;
      const workloadHours = Number(certificate.total_workload_hours);
      if (Number.isFinite(workloadHours) && workloadHours > 0) {
        const formattedHours = Number.isInteger(workloadHours)
          ? String(workloadHours)
          : workloadHours.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
        const hourLabel = workloadHours === 1 ? 'hora-aula' : 'horas-aula';
        certificateBody = `${certificateBody} ( ${formattedHours} ${hourLabel} )`;
      }
      document.fillColor(textColor).font('Helvetica-Bold').fontSize(30).text(certificateTitle, 55, 105, { width: width - 110, align: 'center' });
      document.fillColor(textColor).font('Helvetica').fontSize(16).text('Certificamos que', 80, 205, { width: width - 160, align: 'center' });
      document.fillColor(textColor).font('Helvetica-Bold').fontSize(27).text(certificate.participant_name, 80, 240, { width: width - 160, align: 'center' });
      document.fillColor(textColor).font('Helvetica').fontSize(15).text(certificateBody, 80, 300, { width: width - 160, align: 'center' });
      const dateLabel = certificate.event_date_end && certificate.event_date_end !== certificate.event_date_start
        ? `Realizado de ${certificate.event_date_start} a ${certificate.event_date_end}.`
        : certificate.event_date_start ? `Realizado em ${certificate.event_date_start}.` : '';
      document.fontSize(12).fillColor(textColor).text(dateLabel, 80, 335, { width: width - 160, align: 'center' });
      if (certificate.activities_summary) {
        document.fillColor(textColor).font('Helvetica').fontSize(9).text(
          `Atividades: ${certificate.activities_summary}.`, 80, 382, { width: width - 160, align: 'center', ellipsis: true }
        );
      }
      document.fontSize(10).fillColor(textColor).text(`Código de verificação: ${certificate.certificate_code} · Emissão: ${certificate.issued_at}`, 80, height - 75, { width: width - 160, align: 'center' });
      document.end();
    } catch (error) { reject(error); }
  });
}

const CERTIFICATE_ROLES = {
  participant: { label: 'Participante', title: 'CERTIFICADO DE PARTICIPAÇÃO', body: 'participou do evento {event}.', attendance: true },
  reviewer: { label: 'Revisor', title: 'CERTIFICADO DE REVISÃO', body: 'atuou como revisor(a) de trabalhos científicos no evento {event}.', attendance: false },
  speaker: { label: 'Palestrante', title: 'CERTIFICADO DE PALESTRANTE', body: 'participou como palestrante do evento {event}.', attendance: true },
  teacher: { label: 'Professor', title: 'CERTIFICADO DE PROFESSOR(A)', body: 'ministrou {atividade} no {event}.', attendance: true },
  oral_presenter: { label: 'Apresentador Oral', title: 'CERTIFICADO DE APRESENTAÇÃO ORAL', body: 'realizou apresentação oral no evento {event}.', attendance: true },
  poster_presenter: { label: 'Apresentador Pôster', title: 'CERTIFICADO DE APRESENTAÇÃO DE PÔSTER', body: 'realizou apresentação de pôster no evento {event}.', attendance: true }
};

function certificateRoleMeta(role) { return CERTIFICATE_ROLES[role] || CERTIFICATE_ROLES.participant; }
function certificateText(value, eventName, activityName) {
  let text = String(value || '');
  text = text.replaceAll('{event}', eventName || '');
  if (activityName) { text = text.replaceAll('{atividade}', activityName); }
  return text;
}

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

const eventLogoDir = path.join(__dirname, '..', 'uploads', 'event-logos');
if (!fs.existsSync(eventLogoDir)) fs.mkdirSync(eventLogoDir, { recursive: true });
const eventContentDir = path.join(__dirname, '..', 'uploads', 'event-content');
if (!fs.existsSync(eventContentDir)) fs.mkdirSync(eventContentDir, { recursive: true });
const eventAssetUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'event_pdf' ? eventContentDir : eventLogoDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'logo' && !['image/png', 'image/jpeg'].includes(file.mimetype)) {
      return cb(new Error('LOGO_INVALID_TYPE'));
    }
    if (file.fieldname === 'event_pdf' && (file.mimetype !== 'application/pdf' || path.extname(file.originalname || '').toLowerCase() !== '.pdf')) {
      return cb(new Error('PDF_INVALID_TYPE'));
    }
    cb(null, true);
  }
});

function uploadedEventAsset(req, fieldName) {
  return req.files && req.files[fieldName] ? req.files[fieldName][0] : null;
}

function removeEventContentFile(relativePath) {
  if (!relativePath) return;
  const resolved = path.resolve(path.join(__dirname, '..'), relativePath);
  if (resolved !== eventContentDir && resolved.startsWith(`${eventContentDir}${path.sep}`)) {
    try { fs.unlinkSync(resolved); } catch (error) { if (error.code !== 'ENOENT') console.error('Falha ao remover PDF do evento:', error); }
  }
}

// Executa os uploads do evento e converte erros em mensagem amigável,
// removendo o arquivo em caso de falha, para o form poder ser re-renderizado sem 500.
function runEventAssetUpload(req, res, next) {
  eventAssetUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'event_pdf', maxCount: 1 }])(req, res, (error) => {
    if (error) {
      Object.values(req.files || {}).flat().forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
      req.eventAssetUploadError = error.code === 'LIMIT_FILE_SIZE'
        ? 'Um arquivo excede o limite permitido (logo: 5 MB; PDF: 50 MB).'
        : error.message === 'PDF_INVALID_TYPE'
          ? 'O conteúdo do evento deve ser um arquivo PDF válido (máximo 50 MB).'
          : 'O logo do evento deve ser uma imagem PNG ou JPEG (máximo 5 MB).';
      return next();
    }
    const logo = uploadedEventAsset(req, 'logo');
    if (logo && logo.size > 5 * 1024 * 1024) {
      Object.values(req.files || {}).flat().forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
      req.eventAssetUploadError = 'O logo do evento excede 5 MB.';
      return next();
    }
    const contentPdf = uploadedEventAsset(req, 'event_pdf');
    if (contentPdf) {
      let signature = '';
      let descriptor;
      try {
        descriptor = fs.openSync(contentPdf.path, 'r');
        const header = Buffer.alloc(5);
        fs.readSync(descriptor, header, 0, 5, 0);
        signature = header.toString('ascii');
      } catch (_) {
        signature = '';
      } finally {
        if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch (_) {}
      }
      if (signature !== '%PDF-') {
        Object.values(req.files || {}).flat().forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
        req.eventAssetUploadError = 'O conteúdo do evento deve ser um arquivo PDF válido (máximo 50 MB).';
        return next();
      }
    }
    return validateCsrfToken(req, res, next);
  });
}

const importUploadDir = path.join(__dirname, '..', 'uploads', 'import');
if (!fs.existsSync(importUploadDir)) fs.mkdirSync(importUploadDir, { recursive: true });
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, importUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/csv'].includes(file.mimetype);
    const extOk = ['.xlsx', '.csv'].includes(ext);
    cb(null, mimeOk || extOk);
  }
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

const EVENT_STATUSES = ['draft', 'published', 'encerrado'];

function normalizeEventStatus(status) {
  return EVENT_STATUSES.includes(status) ? status : 'draft';
}

function normalizeEventEmailSettings(body) {
  const settings = {
    email_enabled: body.email_enabled ? 1 : 0,
    email_platform_name: String(body.email_platform_name || '').trim().slice(0, 160),
    email_sender_name: String(body.email_sender_name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160),
    email_signature: String(body.email_signature || '').trim().slice(0, 1000),
    email_contact: String(body.email_contact || '').trim().toLowerCase().slice(0, 254)
  };
  if (settings.email_contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email_contact)) {
    settings.error = 'Informe um e-mail de contato válido para as mensagens do evento.';
  }
  return settings;
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
    systemEmailSettings: getSystemEmailSettings(),
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
      AND COALESCE(registration_status, 'approved') = 'approved'
    GROUP BY event_id
  `).all();
}

function getPendingRegistrationCountByEvent() {
  return db.prepare(`
    SELECT event_id, COUNT(*) as count
    FROM event_registrations
    WHERE registration_type = 'listener' AND registration_status = 'pending'
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

function getEventParticipantSummary(eventId, filters = {}, pagination = null) {
  const params = [eventId];
  const conditions = ['er.event_id = ?'];

  if (filters.category === 'author') {
    conditions.push('er.registration_type = ?');
    params.push('author');
  } else if (filters.category === 'instrutor') {
    conditions.push('EXISTS (SELECT 1 FROM event_user_roles eur WHERE eur.user_id = er.user_id AND eur.event_id = er.event_id AND eur.role IN (?, ?))');
    params.push('teacher', 'speaker');
  }

  if (filters.titulation === 'Não especificado') {
    conditions.push('(u.formacao_titulacao IS NULL OR u.formacao_titulacao = \'\' OR u.formacao_titulacao IS NULL)');
  } else if (filters.titulation && filters.titulation !== 'all') {
    conditions.push('u.formacao_titulacao = ?');
    params.push(filters.titulation);
  }

  if (filters.query) {
    conditions.push(`(
      LOWER(er.name) LIKE ?
      OR LOWER(er.email) LIKE ?
      OR LOWER(COALESCE(er.institution, '')) LIKE ?
      OR LOWER(REPLACE(REPLACE(REPLACE(COALESCE(u.cpf, ''), '.', ''), '-', ''), ' ', '')) LIKE ?
    )`);
    const term = `%${String(filters.query).trim().toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  if (filters.subsidy_requested && filters.subsidy_requested === '1') {
    conditions.push('er.subsidy_requested = 1');
  }

  const sql = `
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
      COALESCE(u.is_public, 0) AS account_active,
      COALESCE(sa.submitted_count, 0) as submitted_articles,
      COALESCE(aa.approved_count, 0) as approved_articles,
      (SELECT COUNT(*) FROM participant_activity_enrollments pae WHERE pae.registration_id=er.id) AS enrolled_activities,
      (SELECT GROUP_CONCAT(ea.name, ' · ') FROM participant_activity_enrollments pae
        JOIN event_activities ea ON ea.id=pae.activity_id WHERE pae.registration_id=er.id) AS activity_names,
      COALESCE((SELECT GROUP_CONCAT(eur.role, ',') FROM event_user_roles eur WHERE eur.user_id=er.user_id AND eur.event_id=er.event_id), '') AS roles,
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
  `;

  if (pagination && pagination.perPage != null && pagination.offset != null) {
    return db.prepare(sql + ' LIMIT ? OFFSET ?').bind(...params, pagination.perPage, pagination.offset).all();
  }

  return db.prepare(sql).bind(...params).all();
}

function countEventParticipants(eventId, filters = {}) {
  const params = [eventId];
  let conditions = ['er.event_id = ?'];
  let instrutorParams = null;

  if (filters.category === 'author') {
    conditions.push('er.registration_type = ?');
    params.push('author');
  } else if (filters.category === 'instrutor') {
    instrutorParams = [eventId, 'teacher', 'speaker'];
    conditions.push('EXISTS (SELECT 1 FROM event_user_roles eur WHERE eur.user_id = er.user_id AND eur.event_id = ? AND eur.role IN (?, ?))');
    params.push(...instrutorParams);
  }

  if (filters.titulation === 'Não especificado') {
    conditions.push('NOT EXISTS (SELECT 1 FROM users u WHERE u.id = er.user_id AND (u.formacao_titulacao IS NOT NULL AND u.formacao_titulacao != \'\'))');
  } else if (filters.titulation && filters.titulation !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM users u WHERE u.id = er.user_id AND u.formacao_titulacao = ?)');
    params.push(filters.titulation);
  }

  if (filters.query) {
    conditions.push(`(
      LOWER(er.name) LIKE ?
      OR LOWER(er.email) LIKE ?
      OR LOWER(COALESCE(er.institution, '')) LIKE ?
      OR LOWER(REPLACE(REPLACE(REPLACE(COALESCE((SELECT u.cpf FROM users u WHERE u.id = er.user_id), ''), '.', ''), '-', ''), ' ', '')) LIKE ?
    )`);
    const term = `%${String(filters.query).trim().toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  if (filters.subsidy_requested && filters.subsidy_requested === '1') {
    conditions.push('er.subsidy_requested = 1');
  }

  return db.prepare(`SELECT COUNT(*) as total FROM event_registrations er WHERE ${conditions.join(' AND ')}`).bind(...params).get().total;
}

function countEventParticipantsDetailed(eventId, filters = {}) {
  const params = [eventId];
  let conditions = ['er.event_id = ?'];

  if (filters.category === 'author') {
    conditions.push('er.registration_type = ?');
    params.push('author');
  } else if (filters.category === 'instrutor') {
    conditions.push('EXISTS (SELECT 1 FROM event_user_roles eur WHERE eur.user_id = er.user_id AND eur.event_id = ? AND eur.role IN (?, ?))');
    params.push(eventId, 'teacher', 'speaker');
  }

  if (filters.titulation === 'Não especificado') {
    conditions.push('NOT EXISTS (SELECT 1 FROM users u WHERE u.id = er.user_id AND (u.formacao_titulacao IS NOT NULL AND u.formacao_titulacao != \'\'))');
  } else if (filters.titulation && filters.titulation !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM users u WHERE u.id = er.user_id AND u.formacao_titulacao = ?)');
    params.push(filters.titulation);
  }

  if (filters.query) {
    conditions.push(`(
      LOWER(er.name) LIKE ?
      OR LOWER(er.email) LIKE ?
      OR LOWER(COALESCE(er.institution, '')) LIKE ?
      OR LOWER(REPLACE(REPLACE(REPLACE(COALESCE((SELECT u.cpf FROM users u WHERE u.id = er.user_id), ''), '.', ''), '-', ''), ' ', '')) LIKE ?
    )`);
    const term = `%${String(filters.query).trim().toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  if (filters.subsidy_requested && filters.subsidy_requested === '1') {
    conditions.push('er.subsidy_requested = 1');
  }

  return db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN registration_type = 'author' THEN 1 ELSE 0 END) as authors,
      SUM(CASE WHEN registration_type = 'listener' THEN 1 ELSE 0 END) as listeners,
      SUM(CASE WHEN approved_count > 0 THEN 1 ELSE 0 END) as approvedPresenters,
      SUM(CASE WHEN subsidy_requested = 1 THEN 1 ELSE 0 END) as subsidyRequests
    FROM event_registrations er
    LEFT JOIN (
      SELECT event_id,
        CASE
          WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
          WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
          ELSE NULL
        END as participant_key,
        COUNT(*) as approved_count
      FROM articles
      WHERE status = 'approved'
      GROUP BY event_id, participant_key
    ) aa ON aa.event_id = er.event_id
     AND aa.participant_key = CASE
        WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
        ELSE 'email:' || LOWER(TRIM(er.email))
      END
    WHERE ${conditions.join(' AND ')}
  `).bind(...params).get();
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
      u.phone as user_phone,
      u.formacao_area as user_formacao_area,
      u.formacao_curso as user_formacao_curso,
      u.formacao_titulacao as user_formacao_titulacao,
      u.formacao_status as user_formacao_status,
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
  const pendingRegistrationByEventId = new Map(getPendingRegistrationCountByEvent().map((row) => [row.event_id, row.count]));
  const subsidyRequestByEventId = new Map(getSubsidyRequestCountByEvent().map((row) => [row.event_id, row.count]));
  const events = db.prepare(`SELECT e.* FROM events e JOIN event_user_roles eur ON eur.event_id=e.id
    WHERE eur.user_id=? AND eur.role='admin' ORDER BY e.date_start DESC`).all(req.session.userId).map((event) => ({
    ...withAreaMeta(event),
    author_registered_count: authorRegistrationByEventId.get(event.id) || 0,
    listener_registered_count: listenerRegistrationByEventId.get(event.id) || 0,
    pending_registration_count: pendingRegistrationByEventId.get(event.id) || 0,
    subsidy_request_count: subsidyRequestByEventId.get(event.id) || 0,
    registered_count: (authorRegistrationByEventId.get(event.id) || 0) + (listenerRegistrationByEventId.get(event.id) || 0)
  }));
  res.render('admin/events/list', {
    events, title: 'Eventos',
    systemEmailSettings: getSystemEmailSettings(),
    pendingEmailCount: getPendingEmailCount(),
    message: req.query.message || null
  });
});

router.post('/:id/email-enabled', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id,name FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const enabled = req.body.enabled === '1';
  const cancelled = setEventEmailEnabled(event.id, enabled, req.session.userId);
  recordParticipantAudit({ eventId: event.id, actorUserId: req.session.userId,
    action: enabled ? 'event_email_enabled' : 'event_email_disabled', details: { cancelled_count: cancelled } });
  const message = enabled ? `E-mails de ${event.name} ativados.` : `E-mails de ${event.name} desativados; ${cancelled} pendência(s) cancelada(s).`;
  res.redirect(`/admin/events?message=${encodeURIComponent(message)}`);
});

// Novo evento
router.get('/new', (req, res) => {
  renderEventForm(res, { event: null, title: 'Novo Evento' });
});

// Criar evento
router.post('/', strictLimiter, runEventAssetUpload, (req, res, next) => {
  validateAndHandle(req, res, next, v.eventFormFull);
}, (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, offers_subsidy, has_article_submission, public_registration, registration_approval_mode } = req.body;
  const normalizedStatus = normalizeEventStatus(status);
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const hasArticleSubmission = has_article_submission ? 1 : 0;
  const publicRegistration = public_registration ? 1 : 0;
  const registrationApprovalMode = registration_approval_mode === 'review' ? 'review' : 'automatic';
  const emailSettings = normalizeEventEmailSettings(req.body);
  const normalizedSubmissionStart = hasArticleSubmission ? (submission_start || null) : null;
  const normalizedSubmissionEnd = hasArticleSubmission ? (submission_end || null) : null;
  const normalizedReviewStart = hasArticleSubmission ? (review_start || null) : null;
  const normalizedReviewEnd = hasArticleSubmission ? (review_end || null) : null;

  if (req.eventAssetUploadError) {
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
        public_registration: publicRegistration,
        registration_approval_mode: registrationApprovalMode,
        ...emailSettings,
        status: normalizedStatus,
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
      error: req.eventAssetUploadError
    });
  }

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

  const formError = emailSettings.error || validationError;

  if (formError) {
    Object.values(req.files || {}).flat().forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
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
        public_registration: publicRegistration,
        registration_approval_mode: registrationApprovalMode,
        ...emailSettings,
        status: normalizedStatus,
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
      error: formError
    });
  }

  const logoFile = uploadedEventAsset(req, 'logo');
  const contentPdfFile = uploadedEventAsset(req, 'event_pdf');
  const createdEvent = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO events (name, short_name, description, date_start, date_end, location, url, area, has_article_submission, offers_subsidy, public_registration, registration_approval_mode,
        email_enabled,email_platform_name,email_sender_name,email_signature,email_contact,status, institution, language, registration_start, registration_end,
        submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, logo_path, logo_original_name,
        content_pdf_path, content_pdf_original_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
    `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, publicRegistration, registrationApprovalMode,
      emailSettings.email_enabled, emailSettings.email_platform_name || null, emailSettings.email_sender_name || null, emailSettings.email_signature || null, emailSettings.email_contact || null,
      normalizedStatus, institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd,
      normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null,
      logoFile ? `uploads/event-logos/${logoFile.filename}` : null, logoFile ? logoFile.originalname : null,
      contentPdfFile ? `uploads/event-content/${contentPdfFile.filename}` : null, contentPdfFile ? contentPdfFile.originalname : null).run();
    db.prepare("INSERT OR IGNORE INTO event_user_roles (event_id,user_id,role,assigned_by) VALUES (? ,? ,'admin',?)").run(info.lastInsertRowid, req.session.userId, req.session.userId);
    return info;
  })();
  res.redirect('/admin/events');
});

// Editar evento
router.get('/:id/edit', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não foi encontrado.' });
  renderEventForm(res, { event, title: 'Editar Evento' });
});

// Atualizar evento (POST direto)
router.post('/:id', strictLimiter, runEventAssetUpload, (req, res, next) => {
  validateAndHandle(req, res, next, v.eventFormFull);
}, (req, res) => {
  const { name, short_name, description, date_start, date_end, location, url, area, status, institution, language, registration_start, registration_end, submission_start, submission_end, review_start, review_end, certificates_start, certificates_end, offers_subsidy, has_article_submission, public_registration, registration_approval_mode } = req.body;
  const normalizedStatus = normalizeEventStatus(status);
  const normalizedArea = normalizeAreaList(area);
  const offersSubsidy = offers_subsidy ? 1 : 0;
  const hasArticleSubmission = has_article_submission ? 1 : 0;
  const publicRegistration = public_registration ? 1 : 0;
  const registrationApprovalMode = registration_approval_mode === 'review' ? 'review' : 'automatic';
  const emailSettings = normalizeEventEmailSettings(req.body);
  const normalizedSubmissionStart = hasArticleSubmission ? (submission_start || null) : null;
  const normalizedSubmissionEnd = hasArticleSubmission ? (submission_end || null) : null;
  const normalizedReviewStart = hasArticleSubmission ? (review_start || null) : null;
  const normalizedReviewEnd = hasArticleSubmission ? (review_end || null) : null;
  const currentAssets = db.prepare('SELECT logo_path, logo_original_name, content_pdf_path, content_pdf_original_name, email_enabled FROM events WHERE id=?').get(req.params.id) || {};

  if (req.eventAssetUploadError) {
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
        public_registration: publicRegistration,
        registration_approval_mode: registrationApprovalMode,
        ...emailSettings,
        status: normalizedStatus,
        institution,
        language,
        registration_start,
        registration_end,
        submission_start: normalizedSubmissionStart,
        submission_end: normalizedSubmissionEnd,
        review_start: normalizedReviewStart,
        review_end: normalizedReviewEnd,
        certificates_start,
        certificates_end,
        logo_path: currentAssets.logo_path || null,
        logo_original_name: currentAssets.logo_original_name || null,
        content_pdf_path: currentAssets.content_pdf_path || null,
        content_pdf_original_name: currentAssets.content_pdf_original_name || null
      }),
      title: 'Editar Evento',
      error: req.eventAssetUploadError
    });
  }

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

  const formError = emailSettings.error || validationError;

  if (formError) {
    Object.values(req.files || {}).flat().forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
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
        public_registration: publicRegistration,
        registration_approval_mode: registrationApprovalMode,
        ...emailSettings,
        status: normalizedStatus,
        institution,
        language,
        registration_start,
        registration_end,
        submission_start: normalizedSubmissionStart,
        submission_end: normalizedSubmissionEnd,
        review_start: normalizedReviewStart,
        review_end: normalizedReviewEnd,
        certificates_start,
        certificates_end,
        logo_path: currentAssets.logo_path || null,
        logo_original_name: currentAssets.logo_original_name || null,
        content_pdf_path: currentAssets.content_pdf_path || null,
        content_pdf_original_name: currentAssets.content_pdf_original_name || null
      }),
      title: 'Editar Evento',
      error: formError
    });
  }

  const logoFile = uploadedEventAsset(req, 'logo');
  const contentPdfFile = uploadedEventAsset(req, 'event_pdf');
  let logoPath = currentAssets.logo_path || null;
  let logoOriginalName = currentAssets.logo_original_name || null;
  if (logoFile) {
    if (logoPath) removeEventLogoFile(logoPath);
    logoPath = `uploads/event-logos/${logoFile.filename}`;
    logoOriginalName = logoFile.originalname;
  } else if (req.body.remove_logo) {
    if (logoPath) removeEventLogoFile(logoPath);
    logoPath = null;
    logoOriginalName = null;
  }

  let contentPdfPath = currentAssets.content_pdf_path || null;
  let contentPdfOriginalName = currentAssets.content_pdf_original_name || null;
  if (contentPdfFile) {
    if (contentPdfPath) removeEventContentFile(contentPdfPath);
    contentPdfPath = `uploads/event-content/${contentPdfFile.filename}`;
    contentPdfOriginalName = contentPdfFile.originalname;
  } else if (req.body.remove_event_pdf) {
    if (contentPdfPath) removeEventContentFile(contentPdfPath);
    contentPdfPath = null;
    contentPdfOriginalName = null;
  }

  db.prepare(`
    UPDATE events SET name=?, short_name=?, description=?, date_start=?, date_end=?, location=?, url=?, area=?, has_article_submission=?, offers_subsidy=?, public_registration=?, registration_approval_mode=?,
      email_enabled=?,email_platform_name=?,email_sender_name=?,email_signature=?,email_contact=?,status=?, institution=?, language=?, registration_start=?, registration_end=?,
      submission_start=?, submission_end=?, review_start=?, review_end=?, certificates_start=?, certificates_end=?, logo_path=?, logo_original_name=?,
      content_pdf_path=?, content_pdf_original_name=?, updated_at=datetime('now', '-3 hours')
    WHERE id=?
  `).bind(name, short_name || '', description || '', date_start, date_end || null, location || '', url || '', normalizedArea, hasArticleSubmission, offersSubsidy, publicRegistration, registrationApprovalMode,
    emailSettings.email_enabled, emailSettings.email_platform_name || null, emailSettings.email_sender_name || null, emailSettings.email_signature || null, emailSettings.email_contact || null,
    normalizedStatus, institution || '', language || '', registration_start || null, registration_end || null, normalizedSubmissionStart, normalizedSubmissionEnd,
    normalizedReviewStart, normalizedReviewEnd, certificates_start || null, certificates_end || null, logoPath, logoOriginalName,
    contentPdfPath, contentPdfOriginalName, req.params.id).run();
  if (Number(currentAssets.email_enabled || 0) !== emailSettings.email_enabled) {
    const cancelled = setEventEmailEnabled(req.params.id, emailSettings.email_enabled, req.session.userId);
    recordParticipantAudit({ eventId: Number(req.params.id), actorUserId: req.session.userId,
      action: emailSettings.email_enabled ? 'event_email_enabled' : 'event_email_disabled', details: { cancelled_count: cancelled, source: 'event_form' } });
  }
  res.redirect('/admin/events');
});

// Deletar evento
router.delete('/:id', (req, res) => {
  const event = db.prepare('SELECT logo_path, content_pdf_path FROM events WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').bind(req.params.id).run();
  if (event && event.logo_path) removeEventLogoFile(event.logo_path);
  if (event && event.content_pdf_path) removeEventContentFile(event.content_pdf_path);
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
    category: ['all', 'author', 'instrutor'].includes(String(req.query.category || 'all')) ? String(req.query.category || 'all') : 'all',
    titulation: ['all', 'Graduado', 'Mestre', 'Doutor', 'Não especificado'].includes(String(req.query.titulation || 'all')) ? String(req.query.titulation || 'all') : 'all',
    subsidy_requested: ['all', '1'].includes(String(req.query.subsidy_requested || 'all')) ? String(req.query.subsidy_requested || 'all') : 'all'
  };

  const perPage = Math.min(parseInt(req.query.per_page) || 50, 200);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const totalParticipants = countEventParticipants(req.params.id, filters);
  const totalPages = Math.max(1, Math.ceil(totalParticipants / perPage));
  const clampedPage = Math.min(page, totalPages);
  const clampedOffset = (clampedPage - 1) * perPage;

  const participants = getEventParticipantSummary(req.params.id, filters, { perPage, offset: clampedOffset });
  const summary = countEventParticipantsDetailed(req.params.id, filters);

  res.render('admin/events/participants', {
    title: `Participantes - ${event.name}`,
    event,
    participants,
    filters,
    summary,
    pagination: {
      currentPage: clampedPage,
      totalPages,
      totalApproved: totalParticipants,
      perPage,
      hasNext: clampedPage < totalPages,
      hasPrev: clampedPage > 1
    },
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// Credenciamento: imprime o crachá do participante direto (PDF), sem encaminhamento para a área do participante
router.get('/:id/participants/:registrationId/qr-presenca/print', async (req, res) => {
  let aborted = false;
  res.on('close', () => { aborted = true; });
  try {
    const eventId = parseInt(req.params.id, 10);
    const registrationId = parseInt(req.params.registrationId, 10);
    if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(registrationId) || registrationId <= 0) {
      return res.status(400).render('error', { title: 'Parâmetros inválidos', message: 'Os parâmetros da solicitação não são válidos.' });
    }
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
    const registration = db.prepare('SELECT * FROM event_registrations WHERE id = ? AND event_id = ?').get(registrationId, eventId);
    if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado', message: 'A inscrição solicitada não existe neste evento.' });
    if (!registration.user_id) {
      return res.status(400).render('error', { title: 'Sem vínculo de conta', message: 'Este participante não possui conta vinculada. O crachá com QR Code de presença exige conta para emitir o código pessoal.' });
    }
    const account = db.prepare('SELECT is_public FROM users WHERE id=?').get(registration.user_id);
    if (!account || !account.is_public) {
      return res.status(400).render('error', { title: 'Conta inativa', message: 'A conta deste participante está inativa e o crachá com QR Code de presença não pode ser emitido. Se for o caso, reative a conta em /admin/users.' });
    }
    const token = ensureEventQrToken(event.id, registration.user_id);
    const roles = getEventQrRoles(event.id, registration.user_id);
    if (aborted) return;
    await renderCrachaPdf(res, { event, registration, roles, token });
  } catch (err) {
    console.error('participant cracha print error:', err);
    const detail = err && err.message ? err.message : String(err);
    if (!res.headersSent) res.status(500).render('error', { title: 'Erro ao gerar o crachá', message: `Não foi possível gerar o crachá para impressão. Detalhes: ${detail}` });
    else res.end();
  }
});

router.get('/:id/import-template', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const template = 'Nome completo;E-mail;Instituição;Telefone;CPF;Passaporte';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao.csv"');
  res.end('\uFEFF' + template);
});

router.get('/:id/import-users', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('admin/events/import-users', {
    title: `Importar Usuários - ${event.name}`,
    event,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/:id/import-users', strictLimiter, importUpload.single('import_file'), validateCsrfToken, async (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  if (!req.file || !req.file.path) {
    return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('Selecione um arquivo XLSX ou CSV com a lista de participantes.')}`);
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  let rows;

  try {
    if (ext === '.csv') {
      const fileContent = fs.readFileSync(req.file.path, 'utf8').replace(/^\uFEFF/, '');
      const parsed = parseCsvContent(fileContent);
      if (parsed.headers.length < 1 || parsed.rows.length < 1) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('O arquivo está vazio ou não possui dados.')}`);
      }
      rows = parsed.rows;
    } else {
      rows = await readFirstSheetRows(req.file.path);
    }
  } catch (error) {
    console.error('[import-users] Read error:', error.message);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('Erro ao ler o arquivo. Certifique-se de que é uma planilha XLSX ou CSV válida.')}`);
  }

  if (!rows || !rows.length) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('O arquivo está vazio ou não possui dados.')}`);
  }

  const rawHeaders = Object.keys(rows[0]).map((h) => h.replace(/^\uFEFF/, ''));
  const normalize = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, '').replace(/\s+/g, '');
  const headers = rawHeaders.map(normalize);

  const findCol = (candidates, rawHeadersOnly) => {
    for (const c of candidates) {
      const exact = headers.find((h) => h === c);
      if (exact) return exact;
    }
    for (const c of candidates) {
      const contained = headers.find((h) => h.includes(c));
      if (contained) return contained;
    }
    if (rawHeadersOnly) {
      for (const c of candidates) {
        const rawMatch = rawHeaders.find((h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(c));
        if (rawMatch) return rawMatch;
      }
    }
    return undefined;
  };

  const colName = findCol(['nomecompleto', 'fullname', 'nomeparticipante', 'nome', 'nomedoparticipante', 'participantname', 'participant'], false) || findCol(['nome'], true);
  const colEmail = findCol(['email', 'e-mail', 'mail', 'correoeletronico', 'emaildo participante', 'emaildoparticipante']);
  const colInstitution = findCol(['instituicao', 'instituicaodo participante', 'instituicaodoparticipante', 'organizacao', 'orgao', 'affiliation', 'instituicaodedocumento', 'instituicaodetrabalho']);
  const colPhone = findCol(['telefone', 'tel', 'phone', 'celular', 'whatsapp', 'numerodetelefone', 'telefonecelular', 'fixedphone', 'mobilephone']);
  const colCpf = findCol(['cpf', 'cpfdobr', 'cpfdobrigado']);
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

  if (!colEmail && !colCpf && !colPassport) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('Coluna de e-mail, CPF ou passaporte não encontrada. O arquivo precisa conter pelo menos uma dessas colunas. Colunas detectadas: ' + rawHeaders.join(', '))}`);
  }

  if (!colEmail) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('Coluna de e-mail não encontrada. O arquivo precisa conter uma coluna com "email" ou "e-mail".')}`);
  }

   const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, institution, cpf, passport, phone, is_public, approval_status, approved_at, password_changed, profile_completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'approved', datetime('now','-3 hours'), 0, 0, datetime('now','-3 hours'), datetime('now','-3 hours'))
  `);
  const updateUser = db.prepare('UPDATE users SET name=COALESCE(?, name), institution=COALESCE(?, institution), phone=COALESCE(?, phone), email=COALESCE(?, email), cpf=COALESCE(?, cpf), passport=COALESCE(?, passport) WHERE id=?');
  const insertRegistration = db.prepare(`
    INSERT OR IGNORE INTO event_registrations (event_id, user_id, name, email, institution, phone, registration_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'listener', datetime('now','-3 hours'), datetime('now','-3 hours'))
  `);
  const findRegistration = db.prepare("SELECT id FROM event_registrations WHERE event_id=? AND user_id=?");
  const findUserByCpf = db.prepare("SELECT id, name, email, cpf FROM users WHERE cpf IS NOT NULL AND cpf != ''");
  const findUserByPassport = db.prepare("SELECT id, name, email, passport FROM users WHERE passport IS NOT NULL AND passport != ''");
  const findUserByEmail = db.prepare("SELECT id, name, email FROM users WHERE LOWER(TRIM(email)) = ?");

   const defaultPassword = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  let imported = 0;
  let skipped = 0;
  let updated = 0;
  let registered = 0;
  let alreadyRegistered = 0;
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
        report.push({ name: personKey, email: personEmail, status: 'ignored', detail: 'Linha sem e-mail, CPF ou passaporte' });
        continue;
      }

      let existing = null;
      if (cpf && cpf.length >= 11) existing = findUserByCpf.get(cpf.replace(/\D/g, ''));
      if (!existing && passport) existing = findUserByPassport.get(passport.replace(/\s+/g, ''));
      if (!existing && email && email !== '[object Object]') existing = findUserByEmail.get(email);

      const nameToUse = nameRaw || (cpf ? cpf.replace(/[\.\-]/g, '') : email ? email.split('@')[0] : 'Importado');

      if (existing) {
        const hasChanges = (nameRaw && nameRaw !== existing.name) || (institution && institution !== existing.institution) || (phone && phone !== existing.phone) || (email && email !== existing.email);
        if (hasChanges) {
          try {
            updateUser.run(nameRaw || null, institution || null, phone || null, email || null, cpf || null, passport || null, existing.id);
            updated += 1;
          } catch (dbErr) {
            console.error('[import-users] DB update error for', email || cpf || passport, ':', dbErr.message);
            report.push({ name: existing.name, email: personEmail, status: 'error', detail: 'Erro ao atualizar usuário: ' + dbErr.message });
            skipped += 1;
            continue;
          }
        }
        const existingReg = findRegistration.get(event.id, existing.id);
        if (!existingReg) {
          try {
            insertRegistration.run(event.id, existing.id, nameToUse, email || null, institution || null, phone || null);
            registered += 1;
            report.push({ name: existing.name, email: personEmail, status: 'success', detail: 'Usuário existente — inscrito no evento' });
          } catch (dbErr) {
            console.error('[import-users] registration error for', email || cpf || passport, ':', dbErr.message);
            report.push({ name: existing.name, email: personEmail, status: 'error', detail: 'Erro ao inscrever: ' + dbErr.message });
          }
        } else {
          alreadyRegistered += 1;
          report.push({ name: existing.name, email: personEmail, status: 'success', detail: 'Usuário existente — já inscrito no evento' });
        }
        skipped += 1;
      } else {
        try {
          const userId = insertUser.run(
            nameToUse, email || null, defaultPassword, institution || null,
            cpf || null, passport || null, phone || null
          ).lastInsertRowid;
          insertRegistration.run(event.id, userId, nameToUse, email || null, institution || null, phone || null);
          imported += 1;
          registered += 1;
          report.push({ name: nameToUse, email: personEmail, status: 'success', detail: 'Usuário criado e inscrito no evento' });
        } catch (dbErr) {
          console.error('[import-users] DB insert error for', email || cpf || passport, ':', dbErr.message);
          skipped += 1;
          report.push({ name: nameToUse, email: personEmail, status: 'error', detail: 'Erro ao criar/inscrever: ' + dbErr.message });
        }
      }
    }
  });

  try {
    dbTx();
  } catch (dbErr) {
    console.error('[import-users] Transaction error:', dbErr.message);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.redirect(`/admin/events/${event.id}/import-users?error=${encodeURIComponent('Erro ao salvar no banco de dados: ' + dbErr.message)}`);
  }

  try { fs.unlinkSync(req.file.path); } catch (_) {}

  const errors = report.filter(r => r.status === 'error').length;
  const successes = report.filter(r => r.status === 'success').length;

  const batchId = createImportBatch({ batchType: 'event_registrations', eventId: event.id, importedBy: req.session.userId, report });
  req.session.importResult = {
    eventId: event.id, eventName: event.name,
    imported, skipped, updated, registered, alreadyRegistered,
    errors, successes, report, success: report.length > 0, batchId
  };
  return res.redirect(`/admin/events/${event.id}/import-result`);
});

router.get('/:id/import-download-csv', (req, res) => {
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
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-importacao-evento-' + req.params.id + '-' + new Date().toISOString().slice(0,10) + '.csv"');
  res.end(csv);
});

router.get('/:id/import-result', (req, res) => {
  const data = req.session.importResult;
  if (!data || String(data.eventId) !== String(req.params.id)) {
    return res.redirect(`/admin/events/${req.params.id}/import-users?error=${encodeURIComponent('Nenhum resultado disponível.')}`);
  }
  const ev = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!ev) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('admin/events/import-users-result', {
    title: `Resultado da Importação - ${data.eventName}`,
    event: ev,
    imported: data.imported, skipped: data.skipped, updated: data.updated,
    registered: data.registered, alreadyRegistered: data.alreadyRegistered,
    errors: data.errors, successes: data.successes,
    report: data.report, success: data.success,
    emailSummary: data.batchId ? getImportBatchEmailSummary(data.batchId) : null,
    systemEmailSettings: getSystemEmailSettings(),
    emailMessage: req.query.email_message || null,
    emailError: req.query.email_error || null
  });
});

router.post('/:id/import-authorize-emails', strictLimiter, (req, res) => {
  const data = req.session.importResult;
  if (!data || String(data.eventId) !== String(req.params.id) || !data.batchId) {
    return res.redirect(`/admin/events/${req.params.id}/import-users?error=${encodeURIComponent('Nenhum lote disponível para autorização.')}`);
  }
  try {
    const queued = authorizeImportBatch(data.batchId, req.session.userId);
    return res.redirect(`/admin/events/${req.params.id}/import-result?email_message=${encodeURIComponent(`${queued} e-mail(s) enfileirado(s).`)}`);
  } catch (error) {
    return res.redirect(`/admin/events/${req.params.id}/import-result?email_error=${encodeURIComponent(error.message)}`);
  }
});

function getRoleActivityAttendance(eventId, userId, role) {
  const activities = db.prepare(`
    SELECT ea.id AS activity_id, ea.name AS activity_name, ea.activity_type,
      ea.date_start, ea.date_end, COALESCE(ea.workload_hours, 0) AS activity_workload,
      (SELECT COUNT(*) FROM activity_sessions s WHERE s.activity_id = ea.id) AS sessions_total
    FROM activity_attendance_records aar
    JOIN event_activities ea ON ea.id = aar.activity_id
    WHERE ea.event_id = ? AND aar.user_id = ? AND aar.role = ?
      AND ea.certificate_enabled = 1
      AND (? <> 'participant' OR EXISTS (
        SELECT 1
        FROM participant_activity_enrollments pae
        WHERE pae.activity_id = aar.activity_id AND pae.user_id = aar.user_id
      ))
    GROUP BY ea.id
    ORDER BY ea.date_start, ea.name
  `).all(eventId, userId, role, role);
  const records = db.prepare(`
    SELECT aar.activity_id, aar.session_id, COALESCE(s.workload_hours, 0) AS session_workload
    FROM activity_attendance_records aar
    JOIN event_activities ea ON ea.id = aar.activity_id
    LEFT JOIN activity_sessions s ON s.id = aar.session_id
    WHERE ea.event_id = ? AND aar.user_id = ? AND aar.role = ? AND ea.certificate_enabled = 1
  `).all(eventId, userId, role);
  const sessionWorkloadByActivity = {};
  const presentSessionsByActivity = {};
  records.forEach((record) => {
    if (record.session_id) {
      sessionWorkloadByActivity[record.activity_id] = (sessionWorkloadByActivity[record.activity_id] || 0) + (Number(record.session_workload) || 0);
      if (!presentSessionsByActivity[record.activity_id]) presentSessionsByActivity[record.activity_id] = new Set();
      presentSessionsByActivity[record.activity_id].add(record.session_id);
    }
  });
  const attended_activities = activities.map((activity) => {
    const hasSessions = Number(activity.sessions_total) > 0;
    const workload_hours = hasSessions ? (sessionWorkloadByActivity[activity.activity_id] || 0) : (Number(activity.activity_workload) || 0);
    return { ...activity, workload_hours, sessions_present: presentSessionsByActivity[activity.activity_id] ? presentSessionsByActivity[activity.activity_id].size : 0 };
  });
  return {
    attended_activities,
    activities_attended: attended_activities.length,
    attendance_count: attended_activities.length,
    total_workload_hours: attended_activities.reduce((sum, activity) => sum + (Number(activity.workload_hours) || 0), 0)
  };
}

function getCertificateRule(eventId, role) {
  const meta = certificateRoleMeta(role);
  const rule = db.prepare('SELECT * FROM event_certificate_rules WHERE event_id = ? AND certificate_role = ?').get(eventId, role);
  return rule || { certificate_role: role, min_attendance: 75, background_id: null, text_color: '#0f172a', title: meta.title, body_text: meta.body };
}

// Tipos de atividade em que qualquer presença já qualifica a pessoa.
const ANY_ATTENDANCE_CERTIFICATE_TYPES = ['oral_presentation', 'poster_presentation', 'roundtable'];

function certificateActivityQualifies(activity, minPercent) {
  if (ANY_ATTENDANCE_CERTIFICATE_TYPES.includes(activity.activity_type)) return true;
  const totalSessions = Number(activity.sessions_total) || 0;
  if (totalSessions === 0) return true;
  const presentSessions = Number(activity.sessions_present) || 0;
  return presentSessions >= Math.ceil((totalSessions * minPercent) / 100);
}

function enrichCertificateCandidate(eventId, role, candidate) {
  const emission = db.prepare(`SELECT id, version FROM certificate_emissions
    WHERE event_id=? AND user_id=? AND certificate_role=? AND status='issued' ORDER BY version DESC LIMIT 1`).get(eventId, candidate.user_id, role);
  const latest = db.prepare(`SELECT MAX(version) AS version FROM certificate_emissions
    WHERE event_id=? AND user_id=? AND certificate_role=?`).get(eventId, candidate.user_id, role);
  return { ...candidate, role, role_label: certificateRoleMeta(role).label, active_emission_id: emission && emission.id, latest_version: latest && latest.version || 0 };
}

function qualifyCertificateAttendance(attendance, minPercent) {
  const qualified = attendance.attended_activities.filter((activity) => certificateActivityQualifies(activity, minPercent));
  return {
    ...attendance,
    total_attended: attendance.attended_activities.length,
    attended_activities: qualified,
    attendance_count: qualified.length,
    total_workload_hours: qualified.reduce((sum, activity) => sum + (Number(activity.workload_hours) || 0), 0),
    eligible: qualified.length > 0
  };
}

function getCertificateCandidates(eventId, role, rule) {
  const minPercent = role === 'reviewer' ? 0 : Math.min(100, Math.max(0, Number(rule.min_attendance) || 0));
  if (role === 'participant') {
    return db.prepare(`SELECT er.id AS registration_id, er.user_id, er.name, er.email, er.registration_type
      FROM event_registrations er WHERE er.event_id=? AND er.user_id IS NOT NULL
      ORDER BY er.name COLLATE NOCASE`).all(eventId).map((item) => {
        const attendance = qualifyCertificateAttendance(getRoleActivityAttendance(eventId, item.user_id, role), minPercent);
        return enrichCertificateCandidate(eventId, role, {
          ...item, ...attendance, text_color: rule.text_color
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
      const attendance = qualifyCertificateAttendance(getRoleActivityAttendance(eventId, item.user_id, role), minPercent);
      const registration = db.prepare('SELECT id FROM event_registrations WHERE event_id=? AND user_id=?').get(eventId, item.user_id);
      return enrichCertificateCandidate(eventId, role, {
        ...item, ...attendance, registration_id: registration ? registration.id : null,
        text_color: rule.text_color
      });
    });
}

router.get('/:id/certificates', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const rules = Object.keys(CERTIFICATE_ROLES).map((role) => getCertificateRule(event.id, role));
  const rolesIssued = db.prepare(`
    SELECT certificate_role, COUNT(*) as issued_count
    FROM certificate_emissions
    WHERE event_id = ? AND status = 'issued'
    GROUP BY certificate_role
  `).bind(event.id).all();
  const issuedByRole = {};
  rolesIssued.forEach((row) => { issuedByRole[row.certificate_role] = row.issued_count; });
  const certificatesByRole = rules.map((rule) => ({
    ...rule,
    role: rule.certificate_role,
    meta: certificateRoleMeta(rule.certificate_role),
    candidates: getCertificateCandidates(event.id, rule.certificate_role, rule),
    certificatesIssued: issuedByRole[rule.certificate_role] || 0
  }));
  const backgrounds = db.prepare('SELECT * FROM certificate_backgrounds ORDER BY name COLLATE NOCASE').all();
  const activities = db.prepare(`
    SELECT ea.*,
      (SELECT COUNT(*) FROM participant_activity_enrollments pae WHERE pae.activity_id=ea.id) AS enrolled_count,
      (SELECT COUNT(*) FROM activity_attendance_records aar WHERE aar.activity_id=ea.id) AS attendees_count
    FROM event_activities ea
    WHERE ea.event_id = ?
    ORDER BY ea.date_start, ea.name
  `).bind(event.id).all();

  res.render('admin/events/certificates', {
    title: `Certificados - ${event.name}`,
    event,
    rules,
    certificatesByRole,
    backgrounds,
    activities,
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

router.get('/:id/certificates/rule/current', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
  const roles = ['participant', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter', 'other'];
  const result = {};
  roles.forEach((role) => {
    const rule = getCertificateRule(event.id, role);
    result[role] = {
      background_id: rule.background_id || '',
      text_color: rule.text_color || '#0f172a',
      title: rule.title || certificateRoleMeta(role).title,
      body_text: rule.body_text || certificateRoleMeta(role).body,
      min_attendance: rule.min_attendance ?? (role === 'reviewer' ? 0 : null)
    };
  });
  res.json(result);
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
    certificate_title: certificateText(req.query.title || rule.title || certificateRoleMeta(role).title, event.name, null),
    certificate_body: certificateText(req.query.body_text || rule.body_text || certificateRoleMeta(role).body, event.name, null),
    background_path: background.file_path,
    activities_attended: 0,
    total_workload_hours: 0
  };
  res.type('application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  renderCertificatePdf(res, preview);
});

function getActivitySessions(activityId) {
  return db.prepare('SELECT * FROM activity_sessions WHERE activity_id=? ORDER BY sequence_no, session_date, id').all(activityId);
}
function resolveSession(activityId, sessionId) {
  const id = sessionId ? Number(sessionId) : null;
  if (!id) return null;
  return db.prepare('SELECT * FROM activity_sessions WHERE id=? AND activity_id=?').get(id, activityId) || null;
}
function sessionDateError(activity, sessionDate) {
  if (!sessionDate) return null;
  if (activity.date_start && String(sessionDate) < String(activity.date_start)) return 'A data da etapa não pode ser anterior ao início da atividade.';
  if (activity.date_end && String(sessionDate) > String(activity.date_end)) return 'A data da etapa não pode ser posterior ao fim da atividade.';
  return null;
}
function activityDateRangeError(dateStart, dateEnd) {
  if (dateStart && dateEnd && String(dateEnd) < String(dateStart)) return 'A data de fim não pode ser anterior à data de início.';
  return null;
}

router.get('/:id/activities', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const activities = db.prepare(`
    SELECT ea.*,
      (SELECT COUNT(*) FROM participant_activity_enrollments pae WHERE pae.activity_id=ea.id) AS enrolled_count,
      (SELECT COUNT(DISTINCT aar.user_id) FROM activity_attendance_records aar WHERE aar.activity_id=ea.id) AS attendees_count,
      (SELECT COUNT(*) FROM activity_sessions s WHERE s.activity_id=ea.id) AS session_count,
      (SELECT COALESCE(SUM(s.workload_hours),0) FROM activity_sessions s WHERE s.activity_id=ea.id) AS sessions_workload
    FROM event_activities ea
    WHERE ea.event_id = ?
    ORDER BY ea.date_start, ea.name
  `).bind(req.params.id).all();
  activities.forEach((activity) => {
    if (Number(activity.session_count || 0) > 0) activity.sessions = getActivitySessions(activity.id);
  });
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
router.post('/:id/activities', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.activityForm);
}, (req, res) => {
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
  const description = ['lecture', 'course'].includes(activityType) ? String(req.body.description || '').trim() : '';
  const workloadHours = Math.max(0, Number(req.body.workload_hours) || 0);
  const certificateEnabled = req.body.certificate_enabled === '1' ? 1 : 0;
  const dateStart = req.body.date_start || null;
  const dateEnd = req.body.date_end || null;
  const videoUrlRaw = String(req.body.video_url || '').trim();
  if (videoUrlRaw.length > 500) {
    return res.redirect(`/admin/events/${event.id}/activities?error=${encodeURIComponent('Link da transmissão de vídeo muito longo (máximo de 500 caracteres).')}`);
  }
  if (!isValidHttpUrl(videoUrlRaw)) {
    return res.redirect(`/admin/events/${event.id}/activities?error=${encodeURIComponent('Informe um link de transmissão HTTP ou HTTPS válido.')}`);
  }
  const videoUrl = videoUrlRaw || null;
  const hasVideo = videoUrl ? 1 : (req.body.has_video === '1' ? 1 : 0);
  const rangeError = activityDateRangeError(dateStart, dateEnd);
  if (rangeError) {
    return res.redirect(`/admin/events/${event.id}/activities?error=${encodeURIComponent(rangeError)}`);
  }
  db.prepare(`INSERT INTO event_activities
    (event_id,name,activity_type,description,date_start,date_end,workload_hours,certificate_enabled,eligible_roles,certificate_role,video_url,has_video)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    event.id, name, activityType, description, dateStart, dateEnd, workloadHours,
    certificateEnabled, eligibleRoles.join(','), eligibleRoles[0], videoUrl, hasVideo
  );
  return res.redirect(`/admin/events/${event.id}/activities?success=${encodeURIComponent('Atividade cadastrada.')}`);
});
router.post('/:id/activities/:activityId', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.activityForm);
}, (req, res) => {
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
  const description = ['lecture', 'course'].includes(activityType) ? String(req.body.description || '').trim() : '';
  const workloadHours = Math.max(0, Number(req.body.workload_hours) || 0);
  const certificateEnabled = req.body.certificate_enabled === '1' ? 1 : 0;
  const dateStart = req.body.date_start || null;
  const dateEnd = req.body.date_end || null;
  const videoUrlRaw = String(req.body.video_url || '').trim();
  if (videoUrlRaw.length > 500) {
    return res.redirect(`/admin/events/${activity.event_id}/activities?edit_activity_id=${activity.id}&error=${encodeURIComponent('Link da transmissão de vídeo muito longo (máximo de 500 caracteres).')}`);
  }
  if (!isValidHttpUrl(videoUrlRaw)) {
    return res.redirect(`/admin/events/${activity.event_id}/activities?edit_activity_id=${activity.id}&error=${encodeURIComponent('Informe um link de transmissão HTTP ou HTTPS válido.')}`);
  }
  const videoUrl = videoUrlRaw || null;
  const hasVideo = videoUrl ? 1 : (req.body.has_video === '1' ? 1 : 0);
  const rangeError = activityDateRangeError(dateStart, dateEnd);
  if (rangeError) {
    return res.redirect(`/admin/events/${activity.event_id}/activities?edit_activity_id=${activity.id}&error=${encodeURIComponent(rangeError)}`);
  }
  db.prepare(`UPDATE event_activities SET name=?,activity_type=?,description=?,date_start=?,date_end=?,workload_hours=?,
    certificate_enabled=?,eligible_roles=?,certificate_role=?,video_url=?,has_video=? WHERE id=?`).run(
    name, activityType, description, dateStart, dateEnd, workloadHours, certificateEnabled,
    eligibleRoles.join(','), eligibleRoles[0], videoUrl, hasVideo, activity.id
  );
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(activity.event_id);
  queueVideoLinkNotifications({ event, activity: { ...activity, name }, oldUrl: activity.video_url, newUrl: videoUrl });
  return res.redirect(`/admin/events/${activity.event_id}/activities?success=${encodeURIComponent('Atividade atualizada.')}`);
});
router.post('/:id/activities/:activityId/certificate-enabled', (req, res) => {
  const activity = db.prepare('SELECT id,event_id FROM event_activities WHERE id=? AND event_id=?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const enabled = req.body.enabled === '1' ? 1 : 0;
  db.prepare('UPDATE event_activities SET certificate_enabled=? WHERE id=?').run(enabled, activity.id);
  return res.redirect(`/admin/events/${activity.event_id}/activities?success=${encodeURIComponent(enabled ? 'Atividade incluída no cálculo dos certificados.' : 'Atividade retirada do cálculo dos certificados.')}`);
});
router.post('/:id/activities/:activityId/delete', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT id,event_id FROM event_activities WHERE id=? AND event_id=?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const attendanceCount = db.prepare('SELECT COUNT(*) AS count FROM activity_attendance_records WHERE activity_id=?').get(activity.id).count;
  if (attendanceCount > 0) {
    return res.redirect(`/admin/events/${activity.event_id}/activities?error=${encodeURIComponent('Não é possível excluir uma atividade que já possui presença registrada.')}`);
  }
  db.prepare('DELETE FROM event_activities WHERE id=?').run(activity.id);
  return res.redirect(`/admin/events/${activity.event_id}/activities?success=${encodeURIComponent('Atividade removida.')}`);
});

router.get('/:id/activities/:activityId/sessions', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const activity = db.prepare('SELECT * FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const sessions = getActivitySessions(activity.id);
  const editingSession = req.query.edit_session_id
    ? sessions.find((session) => Number(session.id) === Number(req.query.edit_session_id)) || null
    : null;
  res.render('admin/events/activity-sessions', {
    title: `Etapas - ${activity.name}`, event, activity, sessions, editingSession,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/:id/activities/:activityId/sessions', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT * FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?error=${encodeURIComponent('Informe o nome da etapa.')}`);
  }
  const sessionDate = req.body.session_date || null;
  const dateError = sessionDateError(activity, sessionDate);
  if (dateError) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?error=${encodeURIComponent(dateError)}`);
  }
  const workloadHours = Math.max(0, Number(req.body.workload_hours) || 0);
  const description = String(req.body.description || '').trim();
  if (description.length > 2000) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?error=${encodeURIComponent('A descrição da etapa deve ter no máximo 2000 caracteres.')}`);
  }
  const videoUrlRaw = String(req.body.video_url || '').trim();
  if (videoUrlRaw.length > 500) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?error=${encodeURIComponent('Link da transmissão da etapa muito longo (máximo de 500 caracteres).')}`);
  }
  if (!isValidHttpUrl(videoUrlRaw)) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?error=${encodeURIComponent('Informe um link de transmissão HTTP ou HTTPS válido.')}`);
  }
  const sessionVideoUrl = videoUrlRaw || null;
  const hasVideo = sessionVideoUrl ? 1 : (req.body.has_video === '1' ? 1 : 0);
  const nextSequence = db.prepare('SELECT COALESCE(MAX(sequence_no),0) + 1 AS next FROM activity_sessions WHERE activity_id=?').get(activity.id).next;
  const createdSession = db.prepare('INSERT INTO activity_sessions (activity_id,name,sequence_no,session_date,workload_hours,description,video_url,has_video) VALUES (?,?,?,?,?,?,?,?)')
    .run(activity.id, name, nextSequence, sessionDate, workloadHours, description, sessionVideoUrl, hasVideo);
  if (sessionVideoUrl) {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(activity.event_id);
    queueVideoLinkNotifications({ event, activity, session: { id: createdSession.lastInsertRowid, name, session_date: sessionDate }, oldUrl: null, newUrl: sessionVideoUrl });
  }
  return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?success=${encodeURIComponent('Etapa adicionada.')}`);
});

router.post('/:id/activities/:activityId/sessions/:sessionId', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT * FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const session = db.prepare('SELECT * FROM activity_sessions WHERE id = ? AND activity_id = ?').get(req.params.sessionId, activity.id);
  if (!session) return res.status(404).render('error', { title: 'Etapa não encontrada' });
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?edit_session_id=${session.id}&error=${encodeURIComponent('Informe o nome da etapa.')}`);
  }
  const sessionDate = req.body.session_date || null;
  const dateError = sessionDateError(activity, sessionDate);
  if (dateError) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?edit_session_id=${session.id}&error=${encodeURIComponent(dateError)}`);
  }
  const workloadHours = Math.max(0, Number(req.body.workload_hours) || 0);
  const description = String(req.body.description || '').trim();
  if (description.length > 2000) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?edit_session_id=${session.id}&error=${encodeURIComponent('A descrição da etapa deve ter no máximo 2000 caracteres.')}`);
  }
  const videoUrlRaw = String(req.body.video_url || '').trim();
  if (videoUrlRaw.length > 500) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?edit_session_id=${session.id}&error=${encodeURIComponent('Link da transmissão da etapa muito longo (máximo de 500 caracteres).')}`);
  }
  if (!isValidHttpUrl(videoUrlRaw)) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?edit_session_id=${session.id}&error=${encodeURIComponent('Informe um link de transmissão HTTP ou HTTPS válido.')}`);
  }
  const sessionVideoUrl = videoUrlRaw || null;
  const hasVideo = sessionVideoUrl ? 1 : (req.body.has_video === '1' ? 1 : 0);
  db.prepare('UPDATE activity_sessions SET name=?,session_date=?,workload_hours=?,description=?,video_url=?,has_video=? WHERE id=?')
    .run(name, sessionDate, workloadHours, description, sessionVideoUrl, hasVideo, session.id);
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(activity.event_id);
  queueVideoLinkNotifications({ event, activity, session: { ...session, name, session_date: sessionDate }, oldUrl: session.video_url, newUrl: sessionVideoUrl });
  return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?success=${encodeURIComponent('Etapa atualizada.')}`);
});

router.post('/:id/activities/:activityId/sessions/:sessionId/delete', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT * FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const session = db.prepare('SELECT * FROM activity_sessions WHERE id = ? AND activity_id = ?').get(req.params.sessionId, activity.id);
  if (!session) return res.status(404).render('error', { title: 'Etapa não encontrada' });
  if (session.video_url) {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(activity.event_id);
    queueVideoLinkNotifications({ event, activity, session, oldUrl: session.video_url, newUrl: null });
  }
  db.prepare('DELETE FROM activity_sessions WHERE id=?').run(session.id);
  return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/sessions?success=${encodeURIComponent('Etapa removida.')}`);
});
router.get('/:id/activities/:activityId/attendance', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const activity = db.prepare('SELECT a.*, e.name AS event_name FROM event_activities a JOIN events e ON e.id = a.event_id WHERE a.id = ? AND a.event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const sessions = getActivitySessions(activity.id);
  const selectedSession = resolveSession(activity.id, req.query.session_id) || sessions[0] || null;
  const allowedRoles = String(activity.eligible_roles || 'participant').split(',').map((role) => role.trim());
  const sessionCondition = selectedSession ? 'AND aar.session_id=?' : 'AND aar.session_id IS NULL';
  const sessionParams = selectedSession ? [selectedSession.id] : [];
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
      JOIN users u ON u.id = ep.person_user_id
      LEFT JOIN activity_attendance_records aar ON aar.activity_id=? AND aar.user_id=ep.person_user_id ${sessionCondition}
      GROUP BY ep.person_user_id
      HAVING COALESCE(u.is_public, 0) = 1
      ORDER BY name COLLATE NOCASE`).all(activity.id, activity.event_id, activity.event_id, activity.event_id, activity.id, ...sessionParams)
    .filter((person) => String(person.roles).split(',').some((role) => allowedRoles.includes(role)));
  const roleLabels = Object.fromEntries(Object.entries(CERTIFICATE_ROLES).map(([role, meta]) => [role, meta.label]));
  people.forEach((person) => {
    const assignedRoles = String(person.roles || '').split(',').map((role) => role.trim()).filter(Boolean);
    person.available_activity_roles = allowedRoles.filter((role) => assignedRoles.includes(role));
  });
  const evaluations = db.prepare(`SELECT u.name, a.evaluation, a.updated_at
    FROM activity_evaluations a JOIN users u ON u.id=a.user_id
    WHERE a.activity_id=? ORDER BY u.name COLLATE NOCASE`).all(activity.id);
  res.render('admin/events/activity-attendance', {
    title: `Presença - ${activity.name}`, event, activity, participants: people, evaluations,
    sessions, selectedSession, roleLabels,
    success: req.query.success || null,
    error: req.query.error || null,
    markedUserId: req.query.marked_user_id ? Number(req.query.marked_user_id) : null
  });
});

router.get('/:id/activities/:activityId/attendance-print', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const activity = db.prepare('SELECT a.*, e.name AS event_name FROM event_activities a JOIN events e ON e.id = a.event_id WHERE a.id = ? AND a.event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const sessions = getActivitySessions(activity.id);
  const selectedSession = resolveSession(activity.id, req.query.session_id) || sessions[0] || null;

  const participants = db.prepare(`
    SELECT p.name, p.email, p.institution
    FROM (
      SELECT DISTINCT
        ep.name,
        ep.email,
        MAX(ep.institution) AS institution,
        MAX(ep.user_id) AS user_id
      FROM (
        SELECT er.user_id, er.name, er.email, er.institution, er.id AS registration_id, 'participant' AS role
          FROM event_registrations er JOIN participant_activity_enrollments pae ON pae.registration_id=er.id AND pae.activity_id=?
          WHERE er.event_id=?
        UNION ALL SELECT eur.user_id, u.name, u.email, u.institution, NULL, eur.role FROM event_user_roles eur JOIN users u ON u.id=eur.user_id WHERE eur.event_id=?
        UNION ALL SELECT DISTINCT ass.reviewer_id, u.name, u.email, u.institution, NULL, 'reviewer'
          FROM assignments ass JOIN articles ar ON ar.id=ass.article_id JOIN users u ON u.id=ass.reviewer_id WHERE ar.event_id=?
      ) ep
      GROUP BY ep.name, ep.email
    ) p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.email != 'admin@admin.com'
      AND (u.id IS NULL OR u.is_public = 1)
    ORDER BY p.name COLLATE NOCASE
  `).all(activity.id, activity.event_id, activity.event_id, activity.event_id);

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 60 });

  const printTitle = selectedSession ? `${activity.name} — ${selectedSession.name}` : activity.name;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="lista-presenca-${encodeURIComponent(printTitle)}.pdf"`);
  doc.pipe(res);
  doc.on('error', (err) => {
    console.error('attendance-print pdf error:', err && err.message);
  });

  const pageWidth = doc.page.width - 120;
  const colName = { x: 60, width: pageWidth * 0.38 };
  const colEmail = { x: 60 + pageWidth * 0.40, width: pageWidth * 0.38 };

  function formatBRDate(dateStr) {
    if (!dateStr) return 'A definir';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  const logoStartY = doc.y;
  if (drawEventLogo(doc, event, { x: (doc.page.width - 150) / 2, y: logoStartY, width: 150, height: 45 })) {
    doc.y = logoStartY + 45 + 10;
    doc.x = 60;
  }
  doc.fontSize(18).text(event.name, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(14).text(printTitle, { align: 'center' });
  doc.moveDown(0.3);
  let headerDate;
  if (selectedSession && selectedSession.session_date) headerDate = formatBRDate(selectedSession.session_date);
  else if (activity.date_start || activity.date_end) {
    const parts = [activity.date_start, activity.date_end].filter(Boolean).map(formatBRDate);
    headerDate = parts.length === 2 && parts[0] !== parts[1] ? `${parts[0]} a ${parts[1]}` : parts[0] || 'A definir';
  } else headerDate = 'A definir';
  doc.fontSize(11).text(headerDate, { align: 'center' });
  doc.moveDown(1);

  const colWidth = pageWidth / 3;
  const headerTextHeight = 14;
  const headerLineGap = 8;
  const firstRowGap = 8;

  function writeHeaderAt(baseY) {
    let y = baseY;
    // Text baseline at y, text height ~14px above baseline
    // Line should be below text, so position it at y + textHeight + gap
    const lineY = y + headerTextHeight + headerLineGap;
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Nome', 60, y, { width: colWidth })
      .text('E-mail', 60 + colWidth + 40, y, { width: colWidth })
      .text('Assinatura', 60 + (colWidth + 40) * 2, y, { width: colWidth });
    doc.moveTo(60, lineY).lineTo(60 + pageWidth, lineY).stroke();
    return lineY + firstRowGap;
  }

  let currentY = writeHeaderAt(doc.y);

  const rowHeight = 26;
  const maxRowsPerPage = Math.floor((doc.page.height - currentY - 40) / rowHeight);

  participants.forEach((row, i) => {
    if (i > 0 && i % maxRowsPerPage === 0) {
      doc.addPage();
      currentY = writeHeaderAt(60);
    }
    const yPos = currentY + (i % maxRowsPerPage) * rowHeight;
    doc.fontSize(9).font('Helvetica')
      .text(row.name || '', 60, yPos, { width: colWidth });
    doc.text(row.email || '', 60 + colWidth + 40, yPos, { width: colWidth });
    doc.text('', 60 + (colWidth + 40) * 2, yPos, { width: colWidth });
    doc.moveTo(60, yPos + 22).lineTo(60 + pageWidth, yPos + 22).stroke({ color: '#ccc' });
  });

  doc.end();
});

router.get('/:id/activities/:activityId/checkin-print', async (req, res) => {
  let aborted = false;
  res.on('close', () => { aborted = true; });
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
    const activity = db.prepare('SELECT a.*, e.name AS event_name FROM event_activities a JOIN events e ON e.id = a.event_id WHERE a.id = ? AND a.event_id = ?').get(req.params.activityId, req.params.id);
    if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
    const sessions = getActivitySessions(activity.id);
    const selectedSession = resolveSession(activity.id, req.query.session_id) || null;
    if (sessions.length > 0 && !selectedSession) {
      return res.status(400).render('error', { title: 'Etapa não informada', message: 'Esta atividade possui etapas. Selecione a etapa para imprimir a folha de presença com QR Code.' });
    }

    let origin = '';
    const eventUrl = String(event.url || '').trim();
    if (eventUrl) {
      try { origin = new URL(eventUrl).origin; } catch (_) { origin = ''; }
    }
    if (!origin) origin = `http://${req.get('host') || 'localhost:3000'}`;
    const checkinUrl = `${origin}/presenca/${event.id}/${activity.id}${selectedSession ? `/${selectedSession.id}` : ''}`;

    const PDFDocument = require('pdfkit');
    const QRCode = require('qrcode');
    const qrBuffer = await QRCode.toBuffer(checkinUrl, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
    if (aborted) return;

    const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
    const printTitle = selectedSession ? `${activity.name} — ${selectedSession.name}` : activity.name;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="presenca-qr-${encodeURIComponent(printTitle)}.pdf"`);
    doc.pipe(res);
    doc.on('error', (err) => {
      console.error('checkin-print pdf error:', err && err.message);
    });

    function formatBRDate(dateStr) {
      if (!dateStr) return 'A definir';
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d)) return dateStr;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    }

    let headerDate;
    if (selectedSession && selectedSession.session_date) headerDate = formatBRDate(selectedSession.session_date);
    else if (activity.date_start || activity.date_end) {
      const parts = [activity.date_start, activity.date_end].filter(Boolean).map(formatBRDate);
      headerDate = parts.length === 2 && parts[0] !== parts[1] ? `${parts[0]} a ${parts[1]}` : parts[0] || 'A definir';
    } else headerDate = 'A definir';

    const logoStartY = doc.y;
    if (drawEventLogo(doc, event, { x: (doc.page.width - 170) / 2, y: logoStartY, width: 170, height: 52 })) {
      doc.y = logoStartY + 52 + 12;
      doc.x = 60;
    }
    doc.fontSize(10).font('Helvetica').text('FOLHA DE PRESENÇA — QR CODE', 60, doc.y, { align: 'center', characterSpacing: 2 });
    doc.moveDown(1.2);
    doc.fontSize(20).font('Helvetica-Bold').text(event.name, { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(15).font('Helvetica').text(activity.name, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).text(`Data: ${headerDate}`, { align: 'center' });
    if (selectedSession) doc.fontSize(12).text(`Etapa: ${selectedSession.name}`, { align: 'center' });
    doc.moveDown(1.5);

    const qrSize = 220;
    const qrX = (doc.page.width - qrSize) / 2;
    const qrY = doc.y;
    doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    doc.y = qrY + qrSize + 24;
    doc.x = 60;
    doc.fontSize(12).font('Helvetica-Bold').text('Para registrar sua presença:', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica')
      .text('Aponte a câmera do celular para o código QR acima, entre no site com sua conta', { align: 'center' })
      .text('e toque em "Marcar presença".', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('checkin-print error:', err);
    const detail = err && err.message ? err.message : String(err);
    if (!res.headersSent) res.status(500).render('error', { title: 'Erro ao gerar a folha', message: `Não foi possível gerar a folha de presença com QR Code. Detalhes: ${detail}` });
    else res.end();
  }
});

// Marca presença de uma pessoa em uma atividade/etapa.
// Compartilhado pelo botão "Marcar presença" da chamada e pela leitura do QR Code do crachá.
function applyAttendanceMark(activity, userId, role, sessionId, actorUserId, extraDetails) {
  const account = db.prepare('SELECT is_public FROM users WHERE id=?').get(userId);
  if (!account || !account.is_public) {
    return { ok: false, error: 'Conta inativa: não é possível marcar presença para esta pessoa. Se for o caso, reative a conta em /admin/users (o histórico existente é preservado).' };
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
    return { ok: false, error: 'A pessoa não possui este papel no evento ou o papel não é elegível para a atividade.' };
  }
  const existing = db.prepare('SELECT id FROM activity_attendance_records WHERE activity_id=? AND user_id=? AND session_id IS ?').get(activity.id, userId, sessionId);
  if (existing) {
    db.prepare("UPDATE activity_attendance_records SET role=?,registration_id=?,marked_by=?,attended_at=datetime('now','-3 hours') WHERE id=?")
      .run(role, registration ? registration.id : null, actorUserId, existing.id);
  } else {
    db.prepare('INSERT INTO activity_attendance_records(activity_id,registration_id,user_id,role,marked_by,session_id) VALUES(?,?,?,?,?,?)')
      .run(activity.id, registration ? registration.id : null, userId, role, actorUserId, sessionId);
  }
  recordParticipantAudit({
    eventId: activity.event_id, registrationId: registration ? registration.id : null,
    actorUserId, action: 'activity_attendance_marked',
    details: Object.assign({ activity_id: activity.id, user_id: userId, session_id: sessionId, role }, extraDetails || {})
  });
  return { ok: true };
}

// Resolve o papel a registrar, com a mesma regra da linha da chamada:
// mantém o papel já marcado; senão "participant" (se inscrito na atividade); senão o primeiro papel elegível da pessoa.
function resolveScanRole(activity, userId, sessionId) {
  const allowedRoles = String(activity.eligible_roles || '').split(',').map((item) => item.trim()).filter(Boolean);
  const existing = db.prepare('SELECT role FROM activity_attendance_records WHERE activity_id=? AND user_id=? AND session_id IS ?').get(activity.id, userId, sessionId);
  if (existing && existing.role && allowedRoles.includes(existing.role)) return existing.role;
  const registration = db.prepare('SELECT id FROM event_registrations WHERE event_id=? AND user_id=?').get(activity.event_id, userId);
  const enrollment = registration && db.prepare('SELECT 1 FROM participant_activity_enrollments WHERE activity_id=? AND registration_id=? AND user_id=?').get(activity.id, registration.id, userId);
  if (allowedRoles.includes('participant') && enrollment) return 'participant';
  const roles = new Set(db.prepare('SELECT role FROM event_user_roles WHERE event_id=? AND user_id=?').all(activity.event_id, userId).map((row) => row.role));
  const reviewer = db.prepare(`SELECT 1 FROM assignments ass JOIN articles ar ON ar.id=ass.article_id WHERE ar.event_id=? AND ass.reviewer_id=? LIMIT 1`).get(activity.event_id, userId);
  if (reviewer) roles.add('reviewer');
  return allowedRoles.find((role) => CERTIFICATE_ROLES[role] && roles.has(role)) || null;
}

// Presença por QR Code do crachá: o admin lê o código na chamada e marca a presença da pessoa.
router.post('/:id/activities/:activityId/attendance/qr', strictLimiter, (req, res) => {
  const activity = db.prepare('SELECT id, event_id, eligible_roles FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const sessions = getActivitySessions(activity.id);
  const session = sessions.length ? (resolveSession(activity.id, req.body.session_id) || sessions[0]) : null;
  const sessionId = session ? session.id : null;
  const sessionQuery = sessionId ? `?session_id=${sessionId}` : '';
  const separator = sessionQuery ? '&' : '?';
  const backWith = (params) => `/admin/events/${activity.event_id}/activities/${activity.id}/attendance${sessionQuery}${separator}${params}`;

  const code = String(req.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{8,16}$/.test(code)) {
    return res.redirect(backWith(`error=${encodeURIComponent('Código inválido. Confira o código exibido no crachá ou na tela do participante.')}`));
  }
  const person = db.prepare(`SELECT q.user_id, u.name AS name FROM event_qr_codes q JOIN users u ON u.id=q.user_id WHERE q.event_id=? AND q.token=?`).get(activity.event_id, code);
  if (!person) {
    return res.redirect(backWith(`error=${encodeURIComponent('Código não reconhecido: ele não pertence a este evento.')}`));
  }
  const role = resolveScanRole(activity, person.user_id, sessionId);
  if (!role) {
    return res.redirect(backWith(`error=${encodeURIComponent(`${person.name} não possui papel elegível para esta atividade.`)}`));
  }
  const result = applyAttendanceMark(activity, person.user_id, role, sessionId, req.session.userId, { via_qr: true });
  if (!result.ok) {
    return res.redirect(backWith(`error=${encodeURIComponent(result.error)}`));
  }
  return res.redirect(backWith(`success=${encodeURIComponent(`Presença registrada: ${person.name}`)}&marked_user_id=${person.user_id}`));
});

router.post('/:id/activities/:activityId/attendance/:userId', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.attendanceAction);
}, (req, res) => {
  const activity = db.prepare('SELECT id, event_id, eligible_roles FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });
  const userId = Number(req.params.userId);
  const role = String(req.body.role || '').trim();
  const sessions = getActivitySessions(activity.id);
  const session = sessions.length ? (resolveSession(activity.id, req.body.session_id) || sessions[0]) : null;
  const sessionId = session ? session.id : null;
  const sessionQuery = sessionId ? `?session_id=${sessionId}` : '';

  if (req.body.action === 'absent' || !role) {
    const existing = db.prepare('SELECT registration_id,role FROM activity_attendance_records WHERE activity_id=? AND user_id=? AND session_id IS ?').get(activity.id, userId, sessionId);
    const removed = db.prepare('DELETE FROM activity_attendance_records WHERE activity_id=? AND user_id=? AND session_id IS ?').run(activity.id, userId, sessionId);
    if (removed.changes) recordParticipantAudit({
      eventId: activity.event_id, registrationId: existing && existing.registration_id,
      actorUserId: req.session.userId, action: 'activity_attendance_removed',
      details: { activity_id: activity.id, user_id: userId, session_id: sessionId, role: existing && existing.role }
    });
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance${sessionQuery}`);
  }

  const result = applyAttendanceMark(activity, userId, role, sessionId, req.session.userId);
  if (!result.ok) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance${sessionQuery}${sessionQuery ? '&' : '?'}error=${encodeURIComponent(result.error)}`);
  }

  res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance${sessionQuery}`);
});

router.post('/:id/activities/:activityId/attendance-bulk', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.attendanceAction);
}, (req, res) => {
  const activity = db.prepare('SELECT id, event_id, eligible_roles FROM event_activities WHERE id = ? AND event_id = ?').get(req.params.activityId, req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Atividade não encontrada' });

  const allowedRoles = String(activity.eligible_roles || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowedRoles.length) {
    return res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance?error=${encodeURIComponent('A atividade não possui perfis elegíveis configurados.')}`);
  }
  const sessions = getActivitySessions(activity.id);
  const session = sessions.length ? (resolveSession(activity.id, req.body.session_id) || sessions[0]) : null;
  const sessionId = session ? session.id : null;
  const sessionQuery = sessionId ? `?session_id=${sessionId}` : '';

  const priorityRoles = ['teacher', 'speaker', 'oral_presenter', 'poster_presenter', 'reviewer', 'participant'];
  const selectedRole = allowedRoles.find(r => priorityRoles.includes(r)) || allowedRoles[0];

  const eligibleUsers = db.prepare(`
    SELECT DISTINCT ep.user_id, ep.name, ep.email,
      (SELECT id FROM event_registrations er WHERE er.event_id=? AND er.user_id=ep.user_id LIMIT 1) AS registration_id,
      (SELECT COALESCE(MAX(u.is_public), 0) FROM users u WHERE u.id=ep.user_id) AS account_active
    FROM (
      SELECT er.user_id, er.name, er.email, er.id AS registration_id, 'participant' AS role
        FROM event_registrations er JOIN participant_activity_enrollments pae ON pae.registration_id=er.id AND pae.activity_id=?
        WHERE er.event_id=?
      UNION ALL SELECT eur.user_id, u.name, u.email, NULL, eur.role FROM event_user_roles eur JOIN users u ON u.id=eur.user_id WHERE eur.event_id=?
      UNION ALL SELECT DISTINCT ass.reviewer_id, u.name, u.email, NULL, 'reviewer'
        FROM assignments ass JOIN articles ar ON ar.id=ass.article_id JOIN users u ON u.id=ass.reviewer_id WHERE ar.event_id=?
    ) ep
    WHERE ep.email != 'admin@admin.com'
    ORDER BY ep.name COLLATE NOCASE
  `).all(activity.event_id, activity.id, activity.event_id, activity.event_id, activity.event_id);

  const bulkAction = String(req.body.bulk_action || '').trim();
  let marked = 0;
  let skipped = 0;

  if (bulkAction === 'unmark_all_present') {
    eligibleUsers.forEach(user => {
      if (!user.user_id) { skipped++; return; }
      const removed = db.prepare('DELETE FROM activity_attendance_records WHERE activity_id=? AND user_id=? AND session_id IS ?').run(activity.id, user.user_id, sessionId);
      if (removed.changes) {
        recordParticipantAudit({
          eventId: activity.event_id, registrationId: user.registration_id || null,
          actorUserId: req.session.userId, action: 'activity_attendance_removed',
          details: { activity_id: activity.id, user_id: user.user_id, session_id: sessionId, bulk: true }
        });
        marked++;
      }
    });
  } else {
    const selectedRole = allowedRoles.find(r => priorityRoles.includes(r)) || allowedRoles[0];
    eligibleUsers.forEach(user => {
      if (!user.user_id) { skipped++; return; }
      if (!user.account_active) { skipped++; return; }
      const hasRoleInEvent = selectedRole === 'participant'
        ? Boolean(user.registration_id)
        : selectedRole === 'reviewer'
          ? Boolean(db.prepare(`SELECT 1 FROM assignments ass JOIN articles ar ON ar.id=ass.article_id WHERE ar.event_id=? AND ass.reviewer_id=? LIMIT 1`).get(activity.event_id, user.user_id))
          : Boolean(db.prepare('SELECT 1 FROM event_user_roles WHERE event_id=? AND user_id=? AND role=?').get(activity.event_id, user.user_id, selectedRole));
      if (!hasRoleInEvent) { skipped++; return; }
      const existing = db.prepare('SELECT id FROM activity_attendance_records WHERE activity_id=? AND user_id=? AND session_id IS ?').get(activity.id, user.user_id, sessionId);
      if (existing) {
        db.prepare("UPDATE activity_attendance_records SET role=?,registration_id=?,attended_at=datetime('now','-3 hours') WHERE id=?")
          .run(selectedRole, user.registration_id || null, existing.id);
      } else {
        db.prepare('INSERT INTO activity_attendance_records(activity_id,registration_id,user_id,role,marked_by,session_id) VALUES(?,?,?,?,?,?)')
          .run(activity.id, user.registration_id || null, user.user_id, selectedRole, req.session.userId, sessionId);
      }
      recordParticipantAudit({
        eventId: activity.event_id, registrationId: user.registration_id || null,
        actorUserId: req.session.userId, action: 'activity_attendance_marked',
        details: { activity_id: activity.id, user_id: user.user_id, session_id: sessionId, role: selectedRole, bulk: true }
      });
      marked++;
    });
  }

  const msg = bulkAction === 'unmark_all_present'
    ? `Presença removida de ${marked} pessoa(s)${skipped > 0 ? ` (${skipped} ignorada(s))` : ''}`
    : `Presença marcada para ${marked} pessoa(s)${skipped > 0 ? ` (${skipped} ignorada(s))` : ''}`;
  res.redirect(`/admin/events/${activity.event_id}/activities/${activity.id}/attendance${sessionQuery}${sessionQuery ? '&' : '?'}success=${encodeURIComponent(msg)}`);
});

router.post('/:id/activities/:activityId/certificate-rule', (req, res) => {
  return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent('As regras de certificado agora são configuradas por papel no evento.')}`);
});

router.post('/:id/certificates/rule', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.certificateRule);
}, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  if (req.body.apply_to_all === '1') {
    return res.redirect(`/admin/events/${event.id}/certificates/rule/apply-to-all?background_id=${encodeURIComponent(req.body.background_id)}&text_color=${encodeURIComponent(req.body.text_color)}`);
  }
  const role = CERTIFICATE_ROLES[req.body.certificate_role] ? req.body.certificate_role : 'participant';
  const minAttendance = role === 'reviewer' ? 0 : Math.min(100, Math.max(0, parseInt(req.body.min_attendance, 10) || 0));
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

router.post('/:id/certificates/rule/apply-to-all', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const backgroundId = req.body.background_id ? parseInt(req.body.background_id, 10) : null;
  const textColor = String(req.body.text_color || '#0f172a').trim();
  const normalizedTextColor = /^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#0f172a';
  if (!backgroundId || !db.prepare('SELECT id FROM certificate_backgrounds WHERE id = ?').get(backgroundId)) {
    return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent('Selecione um fundo de certificado válido.')}`);
  }

  const upsert = db.prepare(`
    INSERT INTO event_certificate_rules (event_id,certificate_role,min_attendance,background_id,text_color,title,body_text,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))
    ON CONFLICT(event_id,certificate_role) DO UPDATE SET background_id=excluded.background_id,text_color=excluded.text_color,updated_by=excluded.updated_by,updated_at=datetime('now','-3 hours')
  `);

  db.transaction(() => {
    for (const role of Object.keys(CERTIFICATE_ROLES)) {
      upsert.run(event.id, role, role === 'reviewer' ? 0 : 75, backgroundId, normalizedTextColor, null, null, req.session.userId);
    }
  })();

  res.redirect(`/admin/events/${event.id}/certificates?success=${encodeURIComponent('Cor e fundo salvos em todos os tipos de certificado.')}`);
});

router.post('/:id/certificates/backgrounds', strictLimiter, (req, res) => {
  certificateBackgroundUpload.single('background_file')(req, res, (error) => {
    if (error || !req.file || !String(req.body.name || '').trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
      const message = error && error.code === 'LIMIT_FILE_SIZE' ? 'O fundo excede 10 MB.' : 'Informe um nome e envie uma imagem PNG ou JPEG.';
      return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent(message)}`);
    }
    validateCsrfToken(req, res, () => {
      db.prepare(`INSERT INTO certificate_backgrounds (name,file_path,original_name,mime_type,created_by,created_at) VALUES (?,?,?,?,?,datetime('now','-3 hours'))`)
        .run(String(req.body.name).trim(), `uploads/certificate-backgrounds/${req.file.filename}`, req.file.originalname, req.file.mimetype, req.session.userId);
      return res.redirect(`/admin/events/${req.params.id}/certificates?success=${encodeURIComponent('Fundo enviado para a biblioteca.')}`);
    });
  });
});

const CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomToken(byteLength, chars) {
  const bytes = crypto.randomBytes(byteLength);
  let out = '';
  for (let i = 0; i < chars; i += 1) {
    out += CODE_CHARSET[bytes[i % byteLength] % CODE_CHARSET.length];
  }
  return out;
}

function generateCertificateCode() {
  return 'CERT-' + randomToken(24, 32);
}

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
  const code = generateCertificateCode();
  const issuedAt = new Date(Date.now() - 3 * 3600000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const mainActivityName = (attendedActivities.length > 0 && attendedActivities[0].activity_name) ? attendedActivities[0].activity_name : null;
  return db.prepare(`INSERT INTO certificate_emissions (event_id,registration_id,user_id,certificate_role,background_id,certificate_code,version,attendance_count,participant_name,event_name,event_date_start,event_date_end,issued_by,reissued_from_id,issued_at,activity_id,activities_attended,total_workload_hours,activities_summary,text_color,certificate_title,certificate_body)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      event.id, participant.registration_id || null, userId, role, rule.background_id, code, version,
      participant.attendance_count, participant.name, event.name,
      event.date_start, event.date_end, actorUserId, reissuedFromId,
      issuedAt, mainActivityId, totalActivities, totalWorkloadHours, activitiesSummary, textColor,
      certificateText(rule.title || certificateRoleMeta(role).title, event.name, mainActivityName), certificateText(rule.body_text || certificateRoleMeta(role).body, event.name, mainActivityName)
    ).lastInsertRowid;
}

router.post('/:id/certificates/:role/:userId/issue', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  const role = CERTIFICATE_ROLES[req.params.role] ? req.params.role : null;
  if (!event || !role) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  try { const emissionId = issueCertificate(event, role, req.params.userId, req.session.userId); recordParticipantAudit({ eventId: event.id, actorUserId: req.session.userId, action: 'certificate_issued', details: { emission_id: emissionId, role, user_id: req.params.userId } }); queueCertificateIssued(event, emissionId); }
  catch (error) { return res.redirect(`/admin/events/${req.params.id}/certificates?error=${encodeURIComponent(error.message)}`); }
  res.redirect(`/admin/events/${req.params.id}/certificates?success=${encodeURIComponent('Certificado emitido com sucesso.')}`);
});

router.post('/:id/certificates/issue-all', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não foi encontrado.' });

  let issued = 0;
  let skipped = 0;
  const pendingEmails = [];
  db.transaction(() => {
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
          pendingEmails.push(emissionId);
          issued += 1;
        } catch (_) {
          skipped += 1;
        }
      });
    });
  })();
  // Os e-mails são enfileirados fora da transação para que uma falha de SMTP
  // não reverta a emissão dos certificados já gravados.
  pendingEmails.forEach((emissionId) => {
    try { queueCertificateIssued(event, emissionId); } catch (emailErr) { console.error('Falha ao enfileirar e-mail de certificado:', emailErr.message); }
  });

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
  try { const emissionId = issueCertificate(event, role, req.params.userId, req.session.userId, previous.id); db.prepare("UPDATE certificate_emissions SET status='reissued' WHERE id=?").run(previous.id); recordParticipantAudit({ eventId:event.id, actorUserId:req.session.userId, action:'certificate_reissued', details:{ previous_emission_id:previous.id, emission_id:emissionId, role, user_id:req.params.userId } }); queueCertificateIssued(event, emissionId); }
  catch (error) { return res.redirect(`/admin/events/${event.id}/certificates?error=${encodeURIComponent(error.message)}`); }
  res.redirect(`/admin/events/${event.id}/certificates?success=${encodeURIComponent('Certificado reemitido com nova versão.')}`);
});

router.get('/:id/certificates/emissions/:emissionId/download', (req, res) => {
  const certificate = db.prepare(`SELECT ce.*, cb.file_path AS background_path FROM certificate_emissions ce LEFT JOIN certificate_backgrounds cb ON cb.id=ce.background_id WHERE ce.id=? AND ce.event_id=?`).get(req.params.emissionId, req.params.id);
  if (!certificate) return res.status(404).render('error', { title: 'Certificado não encontrado' });
  res.type('application/pdf'); res.attachment(`certificado-${certificate.certificate_code}.pdf`); renderCertificatePdf(res, certificate);
});

router.get('/:id/certificates/export-all', (req, res) => {
  const event = db.prepare('SELECT id, name, short_name FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const emissions = db.prepare(`
    SELECT ce.*, cb.file_path AS background_path, u.name AS participant_name
    FROM certificate_emissions ce
    LEFT JOIN certificate_backgrounds cb ON cb.id = ce.background_id
    LEFT JOIN users u ON u.id = ce.user_id
    WHERE ce.event_id = ? AND ce.status = 'issued'
    ORDER BY ce.certificate_role, u.name COLLATE NOCASE, ce.version
  `).all(req.params.id);

  if (!emissions.length) {
    return res.status(404).render('error', { title: 'Nenhum certificado disponível', message: 'Este evento não possui certificados emitidos para exportação.' });
  }

  const archiveName = `${safeArchiveFileName(event.short_name || event.name, 'evento')}-certificados.zip`;
  res.attachment(archiveName);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') console.error('[export-all] warning:', error.message);
  });
  archive.on('error', (error) => {
    console.error('[export-all] archive error:', error.message);
    res.end();
  });
  archive.pipe(res);

  let index = 0;
  const processNext = () => {
    if (index >= emissions.length) {
      archive.finalize();
      return;
    }
    const emission = emissions[index++];
    const fileName = `certificado-${String(emission.version).padStart(2, '0')}-${safeArchiveFileName(emission.participant_name, `user-${emission.user_id}`)}-${roleLabel(emission.certificate_role).toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '')}-v${emission.version}.pdf`;
    generateCertificateBuffer(emission)
      .then((buffer) => {
        if (!buffer || !buffer.length) {
          console.error('[export-all] empty buffer for:', fileName);
          archive.append(Buffer.from(''), { name: fileName });
        } else {
          archive.append(buffer, { name: fileName });
        }
        processNext();
      })
      .catch((error) => {
        console.error('[export-all] generation error for', fileName + ':', error.message);
        archive.append(Buffer.from(''), { name: fileName });
        processNext();
      });
  };
  processNext();
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

router.post('/:id/roles', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, [
    body('role').isIn(['admin', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel inválido.'),
    body('user_id').isInt({ min: 1 }).withMessage('Usuário inválido.'),
    body('article_id').optional().isInt({ min: 1 }).withMessage('Artigo inválido.')
  ]);
}, (req, res) => {
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
    selectedExistingUser: null,
    activities: getActivitiesForParticipantForm(event.id),
    error: null
  });
});

function getParticipantSelectableUser(userId) {
  return db.prepare(`
    SELECT id, name, email, institution, phone
    FROM users
    WHERE id=? AND is_public=1 AND approval_status='approved'
  `).get(userId);
}

router.get('/:id/participants/user-search', strictLimiter, (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 200);
  if (query.length < 2) return res.json({ users: [] });
  const term = `%${query.toLowerCase()}%`;
  const users = db.prepare(`
    SELECT u.id,u.name,u.email,u.institution,u.phone
    FROM users u
    WHERE u.is_public=1 AND u.approval_status='approved'
      AND NOT EXISTS (SELECT 1 FROM event_registrations er WHERE er.event_id=? AND er.user_id=u.id)
      AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.institution,'')) LIKE ? OR LOWER(COALESCE(u.cpf,'')) LIKE ?)
    ORDER BY u.name COLLATE NOCASE,u.email COLLATE NOCASE
    LIMIT 20
  `).all(req.params.id, term, term, term, term);
  return res.json({ users });
});

function getActivitiesForParticipantForm(eventId) {
  return db.prepare(`SELECT id,name,activity_type,date_start,date_end,workload_hours,certificate_enabled
    FROM event_activities WHERE event_id=? ORDER BY date_start,name COLLATE NOCASE`).all(eventId);
}

function normalizeActivityIds(value) {
  const submitted = Array.isArray(value) ? value : [value];
  return [...new Set(submitted.map((id) => Number(id)).filter(Number.isInteger))];
}

function parseRequestedActivityIds(value) {
  try {
    const ids = JSON.parse(value || '[]');
    return Array.isArray(ids) ? [...new Set(ids.map(Number).filter(Number.isInteger))] : [];
  } catch (_) { return []; }
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
  const parseArticleId = (value) => { const parsed = parseInt(value, 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; };
  return allowed.filter((role) => selected.includes(role)).map((role) => ({
    role,
    articleId: role === 'oral_presenter' ? parseArticleId(body.oral_article_id) : role === 'poster_presenter' ? parseArticleId(body.poster_article_id) : null
  }));
}

function validateAndSaveParticipantEventRoles(eventId, userId, body, actorUserId) {
  if (!userId) return 'A inscrição precisa estar vinculada a uma conta para receber papéis no evento.';
  const roles = requestedEventRoles(body);
  for (const item of roles) {
    if (item.role === 'oral_presenter' || item.role === 'poster_presenter') {
      const type = item.role === 'oral_presenter' ? 'oral' : 'poster';
      const article = item.articleId ? db.prepare("SELECT id FROM articles WHERE id=? AND event_id=? AND status='approved' AND type=?").get(item.articleId, eventId, type) : null;
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
  const areas = getAreas();
  const cursosMap = getCursosMap();
  return res.status(400).render('admin/events/participant-form', {
    title: `${registration ? 'Editar' : 'Adicionar'} Participante - ${event.name}`,
    event,
    registration,
    formData,
    selectedExistingUser: formData.account_mode === 'existing' ? getParticipantSelectableUser(formData.existing_user_id) : null,
    activities: getActivitiesForParticipantForm(event.id),
    eventRoles: getParticipantEventRoles(event.id, registration && registration.user_id),
    approvedArticles: getApprovedEventArticles(event.id),
    areas: areas,
    formacaoAreas: areas,
    cursosMap: cursosMap,
    noDegreeCourse: NO_DEGREE_COURSE,
    error
  });
}

function normalizeParticipantForm(body = {}) {
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    institution: String(body.institution || '').trim(),
    phone: String(body.phone || '').trim(),
    registration_type: body.registration_type === 'author' ? 'author' : 'listener',
    account_mode: body.account_mode === 'existing' ? 'existing' : 'new',
    existing_user_id: String(body.existing_user_id || '').trim(),
    activity_ids: normalizeActivityIds(body.activity_ids),
    formacao_area: String(body.formacao_area || '').trim(),
    formacao_curso: String(body.formacao_curso || '').trim(),
    formacao_titulacao: String(body.formacao_titulacao || '').trim(),
    formacao_status: String(body.formacao_status || '').trim()
  };
}

function validateParticipantForm(formData) {
  if (!formData.name || !formData.email) return 'Nome e e-mail são obrigatórios.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Informe um e-mail válido.';
  return null;
}

router.post('/:id/participants', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.participantForm);
}, (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const formData = normalizeParticipantForm(req.body);
  let linkedUser = null;
  if (formData.account_mode === 'existing') {
    if (!formData.existing_user_id) {
      return renderParticipantFormError(res, event, null, formData, 'Selecione uma conta já cadastrada para inscrevê-la no evento.');
    }
    linkedUser = db.prepare(`
      SELECT id, name, email, institution, phone
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
    formData.phone = linkedUser.phone || '';
  }

  const validationError = validateParticipantForm(formData);
  if (validationError) return renderParticipantFormError(res, event, null, formData, validationError);
  const activityValidationError = validateParticipantActivities(event.id, formData.activity_ids);
  if (activityValidationError) return renderParticipantFormError(res, event, null, formData, activityValidationError);

  const temporaryPassword = String(req.body.temporary_password || '');
  const confirmTemporaryPassword = String(req.body.confirm_temporary_password || '');
  if (formData.account_mode === 'new') {
    if (temporaryPassword.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(temporaryPassword)) {
      return renderParticipantFormError(res, event, null, formData, 'A senha temporária deve ter ao menos 8 caracteres, com maiúscula, minúscula e número.');
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

  let registrationId = null;
  try {
    const createParticipantAndRegistration = db.transaction(() => {
      if (formData.account_mode === 'new') {
        const newUser = db.prepare(`
          INSERT INTO users (
            name, email, password, institution, is_public, approval_status, approved_at, password_changed, profile_completed, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, 'approved', datetime('now', '-3 hours'), 0, 0, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
        `).run(
          formData.name,
          formData.email,
          bcrypt.hashSync(temporaryPassword, 10),
          formData.institution || null
        );
        linkedUser = { id: newUser.lastInsertRowid, name: formData.name, email: formData.email };
      }

      const result = db.prepare(`
        INSERT INTO event_registrations (
          event_id, user_id, name, email, institution, phone, registration_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
      `).run(event.id, linkedUser.id, formData.name, formData.email, formData.institution, formData.phone, formData.registration_type);
      registrationId = result.lastInsertRowid;
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

  try {
    const dedupeKey = `manual-registration:${event.id}:${registrationId}`;
    if (formData.account_mode === 'new') {
      queueImportedAccount({ user: linkedUser, event, registration: true, dedupeKey });
    } else {
      queueImportedRegistration({ user: linkedUser, event, dedupeKey });
    }
  } catch (error) {
    console.error('[email] Falha ao enfileirar inclusão manual de participante:', error.message);
  }

  res.redirect(`/admin/events/${event.id}/participants?success=${encodeURIComponent('Participante adicionado com sucesso.')}`);
});

router.get('/:id/participants/:registrationId/review', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id));
  const registration = event && getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!event || !registration) return res.status(404).render('error', { title: 'Solicitação não encontrada' });
  if (registration.registration_status !== 'pending') return res.redirect(`/admin/events/${event.id}/participants?error=${encodeURIComponent('Esta inscrição não está aguardando análise.')}`);
  const requestedIds = parseRequestedActivityIds(registration.requested_activity_ids);
  const activities = getActivitiesForParticipantForm(event.id).filter((activity) => requestedIds.includes(Number(activity.id)));
  return res.render('admin/events/participant-review', { title: `Analisar inscrição - ${event.name}`, event, registration, activities, error: null });
});

router.post('/:id/participants/:registrationId/review', strictLimiter, (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id));
  const registration = event && getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!event || !registration) return res.status(404).render('error', { title: 'Solicitação não encontrada' });
  if (registration.registration_status !== 'pending') return res.redirect(`/admin/events/${event.id}/participants?error=${encodeURIComponent('Esta inscrição não está aguardando análise.')}`);
  const decision = req.body.decision === 'rejected' ? 'rejected' : 'approved';
  const requestedIds = parseRequestedActivityIds(registration.requested_activity_ids);
  const approvedIds = normalizeActivityIds(req.body.activity_ids);
  const invalid = approvedIds.some((id) => !requestedIds.includes(id));
  if (invalid || (decision === 'approved' && !approvedIds.length && requestedIds.length)) {
    const activities = getActivitiesForParticipantForm(event.id).filter((activity) => requestedIds.includes(Number(activity.id)));
    return res.status(400).render('admin/events/participant-review', { title: `Analisar inscrição - ${event.name}`, event, registration, activities,
      error: invalid ? 'Selecione apenas atividades solicitadas pela pessoa.' : 'Selecione ao menos uma atividade para aprovar, ou rejeite a solicitação.' });
  }
  const notes = String(req.body.registration_review_notes || '').trim().slice(0, 2000);
  db.transaction(() => {
    if (decision === 'approved') saveParticipantActivities(registration.id, registration.user_id, approvedIds, req.session.userId);
    db.prepare(`UPDATE event_registrations SET registration_status=?,registration_review_notes=?,registration_reviewed_at=datetime('now','-3 hours'),
      registration_reviewed_by=?,updated_at=datetime('now','-3 hours') WHERE id=?`)
      .run(decision, notes, req.session.userId, registration.id);
    recordParticipantAudit({ eventId: event.id, registrationId: registration.id, actorUserId: req.session.userId,
      action: 'registration_request_reviewed', details: { decision, requested_activity_ids: requestedIds, approved_activity_ids: decision === 'approved' ? approvedIds : [], notes } });
  })();
  try {
    queueRegistrationReviewDecision({ event, registration: { ...registration, registration_review_notes: notes }, decision,
      approvedActivities: activities.filter((activity) => approvedIds.includes(Number(activity.id))),
      approvedAll: decision === 'approved' && approvedIds.length === requestedIds.length });
  } catch (error) {
    console.error('[email] Falha ao enfileirar decisão de inscrição:', error.message);
  }
  return res.redirect(`/admin/events/${event.id}/participants?success=${encodeURIComponent(decision === 'approved' ? 'Inscrição aprovada.' : 'Solicitação de inscrição rejeitada.')}`);
});

router.get('/:id/participants/:registrationId/edit', (req, res) => {
  const event = withAreaMeta(db.prepare('SELECT * FROM events WHERE id = ?').bind(req.params.id).get());
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const registration = getParticipantRegistrationForEvent(req.params.id, req.params.registrationId);
  if (!registration) return res.status(404).render('error', { title: 'Participante não encontrado' });

  const areas = getAreas();
  const cursosMap = getCursosMap();

  res.render('admin/events/participant-form', {
    title: `Editar Participante - ${event.name}`,
    event,
    registration,
    formData: {
      name: registration.name || '',
      email: registration.email || '',
      institution: registration.institution || '',
      phone: registration.user_phone || registration.phone || '',
      registration_type: registration.registration_type || 'listener',
      existing_user_id: registration.user_id || '',
      activity_ids: getParticipantActivityIds(registration.id),
      formacao_area: registration.user_formacao_area || '',
      formacao_curso: registration.user_formacao_curso || '',
      formacao_titulacao: registration.user_formacao_titulacao || '',
      formacao_status: registration.user_formacao_status || ''
    },
    selectedExistingUser: null,
    activities: getActivitiesForParticipantForm(event.id),
    eventRoles: getParticipantEventRoles(event.id, registration.user_id),
    approvedArticles: getApprovedEventArticles(event.id),
    areas: areas,
    formacaoAreas: areas,
    cursosMap: cursosMap,
    noDegreeCourse: NO_DEGREE_COURSE,
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

  const previousEventRoles = registration.user_id ? getParticipantEventRoles(event.id, registration.user_id) : [];
  if (registration.user_id) {
    const rolesError = validateAndSaveParticipantEventRoles(event.id, registration.user_id, req.body, req.session.userId);
    if (rolesError) return renderParticipantFormError(res, event, registration, formData, rolesError);
  }

  try {
    const previousActivityIds = getParticipantActivityIds(registration.id);
    const activitiesChanged = previousActivityIds.length !== formData.activity_ids.length
      || previousActivityIds.some((id) => !formData.activity_ids.includes(id));
    db.transaction(() => {
      db.prepare(`UPDATE event_registrations
        SET name=?,email=?,institution=?,phone=?,registration_type=?,updated_at=datetime('now','-3 hours')
        WHERE id=? AND event_id=?`).run(formData.name, formData.email, formData.institution,
        formData.phone, formData.registration_type, req.params.registrationId, req.params.id);
      saveParticipantActivities(registration.id, registration.user_id, formData.activity_ids, req.session.userId);
      if (registration.user_id) {
        const noDegree = formData.formacao_curso === NO_DEGREE_COURSE;
        db.prepare(`UPDATE users
          SET phone=?,formacao_area=?,formacao_curso=?,formacao_titulacao=?,formacao_status=?,updated_at=datetime('now','-3 hours')
          WHERE id=?`).run(formData.phone || null, formData.formacao_area || null, formData.formacao_curso || null,
          noDegree ? null : (formData.formacao_titulacao || null),
          noDegree ? null : (formData.formacao_status || null),
          registration.user_id);
      }
      recordParticipantAudit({
        eventId: event.id, registrationId: registration.id, actorUserId: req.session.userId,
        action: 'participant_updated_manually',
        details: {
          previous: { name: registration.name, email: registration.email, institution: registration.institution,
            registration_type: registration.registration_type, activity_ids: previousActivityIds, event_roles: previousEventRoles },
          current: { ...formData, event_roles: registration.user_id ? requestedEventRoles(req.body) : [] }
        }
      });
    })();
    if (activitiesChanged) {
      const activities = getActivitiesForParticipantForm(event.id).filter((activity) => formData.activity_ids.includes(Number(activity.id)));
      try {
        queueParticipantActivitiesUpdated({ event, registration: { ...registration, name: formData.name, email: formData.email }, activities });
      } catch (error) {
        console.error('[email] Falha ao enfileirar alteração de atividades:', error.message);
      }
    }
  } catch (error) {
    if (error && String(error.message).includes('UNIQUE constraint failed')) {
      return renderParticipantFormError(res, event, registration, formData, 'Já existe uma inscrição para este e-mail ou conta neste evento.');
    }
    throw error;
  }

  res.redirect(`/admin/events/${req.params.id}/participants?success=${encodeURIComponent('Participante atualizado com sucesso.')}`);
}

// O formulário HTML usa POST diretamente; PUT permanece para integrações legadas.
router.post('/:id/participants/:registrationId', (req, res, next) => {
  validateAndHandle(req, res, next, v.participantForm);
}, updateParticipant);
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

router.post('/:id/subsidies/:registrationId/decision', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.subsidyDecision);
}, (req, res) => {
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
router.post('/:id/publish', strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.publication);
}, (req, res) => {
  db.prepare("UPDATE events SET status = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").bind('published', req.params.id).run();
  res.redirect('/admin/events');
});

// Encerrar evento
router.post('/:id/close', strictLimiter, (req, res) => {
  const event = db.prepare('SELECT id, status FROM events WHERE id = ?').get(req.params.id);
  if (!event) {
    return res.status(404).render('error', { title: 'Evento não encontrado', message: 'O evento solicitado não foi encontrado.' });
  }
  if (event.status !== 'published') {
    return res.redirect('/admin/events');
  }
  db.prepare("UPDATE events SET status = 'encerrado', updated_at = datetime('now', '-3 hours') WHERE id = ?").run(req.params.id);
  res.redirect('/admin/events');
});

module.exports = router;
