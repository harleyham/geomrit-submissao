const crypto = require('crypto');
const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const { db } = require('../db');
const { getEventLogoAbsPath } = require('./event-logo');

const EMAIL_VIEWS = path.join(__dirname, '..', 'views', 'emails');
const MAX_ATTEMPTS = 8;
let transporter = null;
let workerTimer = null;
let reminderTimer = null;
let processing = false;

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function appBaseUrl() {
  return text(process.env.APP_BASE_URL, 'http://localhost:3000').replace(/\/$/, '');
}

function getSystemEmailSettings() {
  return db.prepare('SELECT * FROM system_settings WHERE id=1').get() || { id: 1, email_enabled: 0 };
}

function getPendingEmailCount(eventId = null) {
  if (eventId == null) {
    return db.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE status IN ('queued','failed')").get().count;
  }
  return db.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE event_id=? AND status IN ('queued','failed')").get(eventId).count;
}

function getPendingEmails(limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
  return db.prepare(`SELECT eo.id,eo.recipient_email,eo.recipient_name,eo.message_type,eo.subject,
    eo.status,eo.attempts,eo.available_at,eo.next_attempt_at,eo.last_error,eo.created_at,
    e.id AS event_id,e.name AS event_name
    FROM email_outbox eo
    LEFT JOIN events e ON e.id=eo.event_id
    WHERE eo.status IN ('queued','failed')
    ORDER BY COALESCE(eo.next_attempt_at,eo.available_at),eo.id
    LIMIT ?`).all(safeLimit);
}

function getGlobalIdentity() {
  const address = text(process.env.MAIL_FROM_ADDRESS, text(process.env.SMTP_USER, 'eventos@ham.eng.br'));
  return {
    platformName: text(process.env.MAIL_PLATFORM_NAME, 'Plataforma de Eventos'),
    senderName: text(process.env.MAIL_FROM_NAME, 'Equipe de Eventos'),
    signature: text(process.env.MAIL_SIGNATURE, 'Equipe de Eventos'),
    contact: text(process.env.MAIL_REPLY_TO, address),
    fromAddress: address,
    logoPath: null
  };
}

function getEventIdentity(event) {
  const global = getGlobalIdentity();
  return {
    platformName: text(event.email_platform_name, event.name),
    senderName: text(event.email_sender_name, event.name),
    signature: text(event.email_signature, 'Equipe organizadora'),
    contact: text(event.email_contact, global.contact),
    fromAddress: global.fromAddress,
    logoPath: event.logo_path || null
  };
}

function canQueueEmail(eventId = null) {
  if (!getSystemEmailSettings().email_enabled) return { allowed: false, reason: 'Master switch global desativado.' };
  if (eventId != null) {
    const event = db.prepare('SELECT email_enabled FROM events WHERE id=?').get(eventId);
    if (!event || !event.email_enabled) return { allowed: false, reason: 'Envio de e-mails do evento desativado.' };
  }
  return { allowed: true, reason: null };
}

function revokeTokensForOutbox(whereSql, params = []) {
  db.prepare(`UPDATE user_setup_tokens SET revoked_at=datetime('now','-3 hours')
    WHERE used_at IS NULL AND revoked_at IS NULL AND id IN (
      SELECT setup_token_id FROM email_outbox WHERE setup_token_id IS NOT NULL AND ${whereSql}
    )`).run(...params);
}

function setSystemEmailEnabled(enabled, actorUserId) {
  const value = enabled ? 1 : 0;
  let cancelled = 0;
  db.transaction(() => {
    if (!value) {
      revokeTokensForOutbox("status IN ('queued','failed')");
      cancelled = db.prepare(`UPDATE email_outbox SET status='cancelled',cancelled_at=datetime('now','-3 hours'),
        last_error='Master switch global desativado.',updated_at=datetime('now','-3 hours')
        WHERE status IN ('queued','failed')`).run().changes;
    }
    db.prepare("UPDATE system_settings SET email_enabled=?,updated_by=?,updated_at=datetime('now','-3 hours') WHERE id=1")
      .run(value, actorUserId || null);
    db.prepare(`INSERT INTO email_settings_log (enabled,changed_by,cancelled_count,scope,created_at)
      VALUES (?,?,?,'system',datetime('now','-3 hours'))`).run(value, actorUserId || null, cancelled);
  })();
  return cancelled;
}

function setEventEmailEnabled(eventId, enabled, actorUserId) {
  const value = enabled ? 1 : 0;
  let cancelled = 0;
  db.transaction(() => {
    if (!value) {
      revokeTokensForOutbox("event_id=? AND status IN ('queued','failed')", [eventId]);
      cancelled = db.prepare(`UPDATE email_outbox SET status='cancelled',cancelled_at=datetime('now','-3 hours'),
        last_error='Envio de e-mails do evento desativado.',updated_at=datetime('now','-3 hours')
        WHERE event_id=? AND status IN ('queued','failed')`).run(eventId).changes;
    }
    db.prepare("UPDATE events SET email_enabled=?,updated_at=datetime('now','-3 hours') WHERE id=?").run(value, eventId);
    db.prepare(`INSERT INTO email_settings_log (enabled,changed_by,cancelled_count,scope,event_id,created_at)
      VALUES (?,?,?,'event',?,datetime('now','-3 hours'))`).run(value, actorUserId || null, cancelled, eventId);
  })();
  return cancelled;
}

function enqueueEmail(options) {
  const eventId = options.eventId || null;
  const permission = canQueueEmail(eventId);
  const identity = options.identity || getGlobalIdentity();
  const status = permission.allowed ? 'queued' : 'suppressed';
  const payload = { ...(options.payload || {}), platformName: (options.payload && options.payload.platformName) || identity.platformName, signature: identity.signature };
  const result = db.prepare(`INSERT OR IGNORE INTO email_outbox
    (event_id,user_id,setup_token_id,recipient_email,recipient_name,message_type,template_name,subject,payload_json,
     from_name,reply_to,logo_path,group_key,dedupe_key,status,available_at,last_error,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))`).run(
      eventId, options.userId || null, options.setupTokenId || null,
      text(options.recipientEmail).toLowerCase(), text(options.recipientName), options.messageType,
      options.templateName, options.subject, JSON.stringify(payload), identity.senderName,
      identity.contact, identity.logoPath, options.groupKey || null,
      options.dedupeKey || `${options.messageType}:${crypto.randomUUID()}`, status,
      options.availableAt || new Date(Date.now() - 3 * 3600000).toISOString().replace('T', ' ').slice(0, 19),
      permission.reason
    );
  return { id: result.lastInsertRowid || null, status, inserted: result.changes > 0 };
}

function createSetupToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  db.prepare("UPDATE user_setup_tokens SET revoked_at=datetime('now','-3 hours') WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL").run(userId);
  const result = db.prepare(`INSERT INTO user_setup_tokens (user_id,token_hash,expires_at,created_at)
    VALUES (?,?,datetime('now','-3 hours','+72 hours'),datetime('now','-3 hours'))`).run(userId, hash);
  return { id: result.lastInsertRowid, raw };
}

function queueAccountRequested(user) {
  const identity = getGlobalIdentity();
  return enqueueEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.name,
    messageType: 'account_requested', templateName: 'account-requested',
    subject: 'Recebemos sua solicitação de cadastro', identity,
    dedupeKey: `account-requested:${user.id}`,
    payload: { name: user.name, platformName: identity.platformName }
  });
}

function queueAccountApproved(user) {
  const identity = getGlobalIdentity();
  return enqueueEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.name,
    messageType: 'account_approved', templateName: 'account-approved',
    subject: 'Seu cadastro foi aprovado', identity,
    dedupeKey: `account-approved:${user.id}:${Date.now()}`,
    payload: { name: user.name, loginUrl: `${appBaseUrl()}/login`, platformName: identity.platformName }
  });
}

function queueImportedAccount({ user, event = null, registration = false, dedupeKey }) {
  const identity = event ? getEventIdentity(event) : getGlobalIdentity();
  const token = createSetupToken(user.id);
  const setupUrl = `${appBaseUrl()}/definir-senha?token=${encodeURIComponent(token.raw)}`;
  const templateName = registration ? 'imported-account-registration' : 'imported-account';
  const subject = registration ? `Sua conta e inscrição em ${event.name} foram criadas` : 'Sua conta foi criada';
  return enqueueEmail({
    eventId: event && event.id, userId: user.id, setupTokenId: token.id,
    recipientEmail: user.email, recipientName: user.name,
    messageType: templateName.replaceAll('-', '_'), templateName, subject, identity, dedupeKey,
    payload: { name: user.name, eventName: event && event.name, setupUrl, platformName: identity.platformName }
  });
}

function queueImportedRegistration({ user, event, dedupeKey }) {
  const identity = getEventIdentity(event);
  return enqueueEmail({
    eventId: event.id, userId: user.id, recipientEmail: user.email, recipientName: user.name,
    messageType: 'imported_registration', templateName: 'imported-registration',
    subject: `Sua inscrição em ${event.name} foi confirmada`, identity, dedupeKey,
    payload: { name: user.name, eventName: event.name, eventUrl: `${appBaseUrl()}/evento/${event.id}`, platformName: identity.platformName }
  });
}

function createImportBatch({ batchType, eventId = null, importedBy = null, report }) {
  const batch = db.prepare(`INSERT INTO import_batches (batch_type,event_id,imported_by,created_at)
    VALUES (?,?,?,datetime('now','-3 hours'))`).run(batchType, eventId, importedBy);
  const insert = db.prepare(`INSERT INTO import_batch_entries
    (batch_id,user_id,registration_id,recipient_name,recipient_email,outcome,email_kind,email_status,created_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','-3 hours'))`);
  const findUser = db.prepare('SELECT id,name,email FROM users WHERE LOWER(TRIM(email))=LOWER(TRIM(?))');
  const findRegistration = db.prepare('SELECT id FROM event_registrations WHERE event_id=? AND user_id=?');
  db.transaction(() => {
    (report || []).forEach((item) => {
      const user = item.email && item.email !== '(não informado)' ? findUser.get(item.email) : null;
      let emailKind = null;
      if (batchType === 'users' && item.detail === 'Usuário criado') emailKind = 'account';
      if (batchType === 'event_registrations' && item.detail === 'Usuário criado e inscrito no evento') emailKind = 'account_registration';
      if (batchType === 'event_registrations' && item.detail === 'Usuário existente — inscrito no evento') emailKind = 'registration';
      const registration = eventId && user ? findRegistration.get(eventId, user.id) : null;
      insert.run(batch.lastInsertRowid, user && user.id, registration && registration.id,
        (user && user.name) || item.name, (user && user.email) || item.email,
        item.status, emailKind, emailKind ? 'awaiting_authorization' : 'not_applicable');
    });
  })();
  return batch.lastInsertRowid;
}

function getImportBatchEmailSummary(batchId) {
  const batch = db.prepare('SELECT * FROM import_batches WHERE id=?').get(batchId);
  if (!batch) return null;
  const rows = db.prepare(`SELECT email_kind,COUNT(*) AS count FROM import_batch_entries
    WHERE batch_id=? AND email_kind IS NOT NULL GROUP BY email_kind`).all(batchId);
  const counts = { account: 0, account_registration: 0, registration: 0, total: 0 };
  rows.forEach((row) => { counts[row.email_kind] = row.count; counts.total += row.count; });
  return { batch, counts };
}

function authorizeImportBatch(batchId, actorUserId) {
  const batch = db.prepare('SELECT * FROM import_batches WHERE id=?').get(batchId);
  if (!batch) throw new Error('Lote de importação não encontrado.');
  if (batch.email_authorized_at) throw new Error('Os e-mails deste lote já foram autorizados.');
  const permission = canQueueEmail(batch.event_id);
  if (!permission.allowed) throw new Error(permission.reason);
  const event = batch.event_id ? db.prepare('SELECT * FROM events WHERE id=?').get(batch.event_id) : null;
  const entries = db.prepare(`SELECT * FROM import_batch_entries WHERE batch_id=? AND email_kind IS NOT NULL
    AND email_status='awaiting_authorization' ORDER BY id`).all(batch.id);
  let queued = 0;
  db.transaction(() => {
    entries.forEach((entry) => {
      const user = entry.user_id ? db.prepare('SELECT id,name,email FROM users WHERE id=?').get(entry.user_id) : null;
      if (!user || !user.email) {
        db.prepare("UPDATE import_batch_entries SET email_status='not_applicable' WHERE id=?").run(entry.id);
        return;
      }
      const dedupeKey = `import:${batch.id}:${entry.id}`;
      let result;
      if (entry.email_kind === 'account') result = queueImportedAccount({ user, dedupeKey });
      else if (entry.email_kind === 'account_registration') result = queueImportedAccount({ user, event, registration: true, dedupeKey });
      else result = queueImportedRegistration({ user, event, dedupeKey });
      db.prepare('UPDATE import_batch_entries SET email_status=? WHERE id=?').run(result.status, entry.id);
      if (result.inserted) queued += 1;
    });
    db.prepare("UPDATE import_batches SET email_authorized_at=datetime('now','-3 hours'),email_authorized_by=? WHERE id=?")
      .run(actorUserId || null, batch.id);
  })();
  return queued;
}

function queueCertificateIssued(event, emissionId) {
  const emission = db.prepare(`SELECT ce.*,u.name,u.email FROM certificate_emissions ce
    JOIN users u ON u.id=ce.user_id WHERE ce.id=?`).get(emissionId);
  if (!emission || !emission.email) return null;
  const identity = getEventIdentity(event);
  const roleLabels = { participant: 'Participante', reviewer: 'Revisor', speaker: 'Palestrante', teacher: 'Professor', oral_presenter: 'Apresentador Oral', poster_presenter: 'Apresentador Pôster' };
  const reissue = !!emission.reissued_from_id;
  return enqueueEmail({
    eventId: event.id, userId: emission.user_id, recipientEmail: emission.email, recipientName: emission.name,
    messageType: reissue ? 'certificate_reissued' : 'certificate_issued', templateName: 'certificate-issued',
    subject: reissue ? 'Uma nova versão do seu certificado está disponível' : `Seu certificado de ${event.name} está disponível`,
    identity, dedupeKey: `certificate:${emission.id}`,
    payload: { name: emission.name, eventName: event.name, roleLabel: roleLabels[emission.certificate_role] || emission.certificate_role,
      version: emission.version, certificateCode: emission.certificate_code, reissue,
      certificatesUrl: `${appBaseUrl()}/author/certificates`, platformName: identity.platformName }
  });
}

function videoChangeKind(initialUrl, finalUrl) {
  if (!finalUrl) return 'removed';
  return initialUrl ? 'updated' : 'available';
}

function videoSubject(kind, activityName) {
  if (kind === 'removed') return `Link de transmissão temporariamente indisponível: ${activityName}`;
  if (kind === 'updated') return `Link de transmissão atualizado: ${activityName}`;
  return `Link de transmissão disponível: ${activityName}`;
}

function queueVideoLinkNotifications({ event, activity, session = null, oldUrl, newUrl }) {
  const initialOld = text(oldUrl) || null;
  const finalNew = text(newUrl) || null;
  if (initialOld === finalNew) return 0;
  const recipients = db.prepare(`SELECT DISTINCT u.id,u.name,u.email FROM participant_activity_enrollments pae
    JOIN users u ON u.id=pae.user_id
    WHERE pae.activity_id=? AND u.is_public=1 AND u.approval_status='approved' AND TRIM(u.email)!=''`).all(activity.id);
  const identity = getEventIdentity(event);
  const groupKey = session ? `video-link:session:${session.id}` : `video-link:activity:${activity.id}`;
  let count = 0;
  recipients.forEach((user) => {
    const existing = db.prepare("SELECT * FROM email_outbox WHERE group_key=? AND user_id=? AND status='queued' ORDER BY id DESC LIMIT 1").get(groupKey, user.id);
    let originalUrl = initialOld;
    if (existing) {
      try { originalUrl = JSON.parse(existing.payload_json).initialUrl || null; } catch (_) {}
      if ((originalUrl || null) === finalNew) {
        db.prepare("UPDATE email_outbox SET status='cancelled',cancelled_at=datetime('now','-3 hours'),last_error='Alteração revertida antes do envio.',updated_at=datetime('now','-3 hours') WHERE id=?").run(existing.id);
        return;
      }
    }
    const kind = videoChangeKind(originalUrl, finalNew);
    const payload = { name: user.name, eventName: event.name, activityName: activity.name,
      sessionName: session && session.name, sessionDate: session && session.session_date,
      initialUrl: originalUrl, transmissionUrl: finalNew,
      eventUrl: `${appBaseUrl()}/evento/${event.id}`, kind, platformName: identity.platformName };
    if (existing) {
      db.prepare(`UPDATE email_outbox SET subject=?,payload_json=?,from_name=?,reply_to=?,logo_path=?,
        available_at=datetime('now','-3 hours','+5 minutes'),updated_at=datetime('now','-3 hours') WHERE id=?`)
        .run(videoSubject(kind, activity.name), JSON.stringify(payload), identity.senderName, identity.contact, identity.logoPath, existing.id);
      count += 1;
      return;
    }
    const queued = enqueueEmail({
      eventId: event.id, userId: user.id, recipientEmail: user.email, recipientName: user.name,
      messageType: 'video_link_changed', templateName: 'video-link', subject: videoSubject(kind, activity.name),
      identity, groupKey, dedupeKey: `${groupKey}:${user.id}:${crypto.randomUUID()}`,
      availableAt: new Date(Date.now() - 3 * 3600000 + 5 * 60000).toISOString().replace('T', ' ').slice(0, 19), payload
    });
    if (queued.inserted) count += 1;
  });
  return count;
}

function brazilNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function tomorrowDate(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function queueDueEventReminders() {
  const now = brazilNowParts();
  if (now.hour < 9) return 0;
  const target = tomorrowDate(now.date);
  const events = db.prepare("SELECT * FROM events WHERE status='published' AND date_start=?").all(target);
  let count = 0;
  events.forEach((event) => {
    const identity = getEventIdentity(event);
    const recipients = db.prepare(`SELECT DISTINCT u.id,u.name,u.email FROM event_registrations er
      JOIN users u ON u.id=er.user_id WHERE er.event_id=? AND u.is_public=1 AND u.approval_status='approved' AND TRIM(u.email)!=''`).all(event.id);
    recipients.forEach((user) => {
      const queued = enqueueEmail({
        eventId: event.id, userId: user.id, recipientEmail: user.email, recipientName: user.name,
        messageType: 'event_reminder', templateName: 'event-reminder', subject: `Lembrete: ${event.name} acontece amanhã`,
        identity, dedupeKey: `event-reminder:${event.id}:${user.id}:${event.date_start}`,
        payload: { name: user.name, eventName: event.name, dateStart: event.date_start, dateEnd: event.date_end,
          location: event.location, siteUrl: event.url, eventUrl: `${appBaseUrl()}/evento/${event.id}`, platformName: identity.platformName }
      });
      if (queued.inserted) count += 1;
    });
  });
  return count;
}

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: text(process.env.SMTP_HOST, 'smtp.zoho.com'), port,
    secure: String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

async function renderMessage(row) {
  const payload = JSON.parse(row.payload_json || '{}');
  const event = row.event_id ? db.prepare('SELECT * FROM events WHERE id=?').get(row.event_id) : null;
  const logoAbs = event && getEventLogoAbsPath({ logo_path: row.logo_path });
  const bodyHtml = await ejs.renderFile(path.join(EMAIL_VIEWS, `${row.template_name}.ejs`), payload);
  const html = await ejs.renderFile(path.join(EMAIL_VIEWS, 'layout.ejs'), {
    bodyHtml, logoCid: logoAbs ? 'event-logo' : null,
    platformName: payload.platformName || row.from_name,
    signature: payload.signature || (event ? getEventIdentity(event).signature : getGlobalIdentity().signature),
    contact: row.reply_to, recipientEmail: row.recipient_email
  });
  let plain = bodyHtml.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h\d>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
  const urls = Object.entries(payload).filter(([key, value]) => /Url$/.test(key) && value).map(([, value]) => value);
  if (urls.length) plain += `\n\nLinks:\n${[...new Set(urls)].join('\n')}`;
  return { html, text: plain, logoAbs };
}

async function processEmailQueue() {
  if (processing) return;
  processing = true;
  try {
    const row = db.prepare(`SELECT * FROM email_outbox WHERE status IN ('queued','failed') AND attempts<?
      AND available_at<=datetime('now','-3 hours') AND (next_attempt_at IS NULL OR next_attempt_at<=datetime('now','-3 hours'))
      ORDER BY id LIMIT 1`).get(MAX_ATTEMPTS);
    if (!row) return;
    const permission = canQueueEmail(row.event_id);
    if (!permission.allowed) {
      if (row.setup_token_id) db.prepare("UPDATE user_setup_tokens SET revoked_at=datetime('now','-3 hours') WHERE id=? AND used_at IS NULL").run(row.setup_token_id);
      db.prepare("UPDATE email_outbox SET status='cancelled',cancelled_at=datetime('now','-3 hours'),last_error=?,updated_at=datetime('now','-3 hours') WHERE id=?")
        .run(permission.reason, row.id);
      return;
    }
    if (row.user_id && row.message_type !== 'account_requested') {
      const user = db.prepare('SELECT is_public,approval_status FROM users WHERE id=?').get(row.user_id);
      if (!user || !user.is_public || user.approval_status !== 'approved') {
        if (row.setup_token_id) db.prepare("UPDATE user_setup_tokens SET revoked_at=datetime('now','-3 hours') WHERE id=? AND used_at IS NULL").run(row.setup_token_id);
        db.prepare("UPDATE email_outbox SET status='cancelled',cancelled_at=datetime('now','-3 hours'),last_error='Conta destinatária inativa ou não aprovada.',updated_at=datetime('now','-3 hours') WHERE id=?").run(row.id);
        return;
      }
    }
    db.prepare("UPDATE email_outbox SET status='sending',attempts=attempts+1,updated_at=datetime('now','-3 hours') WHERE id=?").run(row.id);
    try {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('Credenciais SMTP não configuradas.');
      const rendered = await renderMessage(row);
      const address = getGlobalIdentity().fromAddress;
      await getTransporter().sendMail({
        from: { name: row.from_name || getGlobalIdentity().senderName, address },
        to: { name: row.recipient_name || '', address: row.recipient_email },
        replyTo: row.reply_to || undefined, subject: row.subject,
        html: rendered.html, text: rendered.text,
        attachments: rendered.logoAbs ? [{ filename: path.basename(rendered.logoAbs), path: rendered.logoAbs, cid: 'event-logo' }] : []
      });
      db.prepare("UPDATE email_outbox SET status='sent',sent_at=datetime('now','-3 hours'),last_error=NULL,updated_at=datetime('now','-3 hours') WHERE id=?").run(row.id);
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const waitSeconds = Math.min(3600, 60 * (2 ** Math.max(0, attempts - 1)));
      db.prepare(`UPDATE email_outbox SET status='failed',last_error=?,next_attempt_at=datetime('now','-3 hours',?),updated_at=datetime('now','-3 hours') WHERE id=?`)
        .run(String(error.message || error).slice(0, 1000), `+${waitSeconds} seconds`, row.id);
      console.error('[email] Falha no envio:', row.id, error.message);
    }
  } finally {
    processing = false;
  }
}

function startEmailWorkers() {
  db.prepare("UPDATE email_outbox SET status='failed',next_attempt_at=datetime('now','-3 hours'),last_error='Envio interrompido por reinício.' WHERE status='sending'").run();
  workerTimer = setInterval(processEmailQueue, 15000);
  reminderTimer = setInterval(queueDueEventReminders, 5 * 60 * 1000);
  workerTimer.unref();
  reminderTimer.unref();
  processEmailQueue();
  queueDueEventReminders();
}

function stopEmailWorkers() {
  if (workerTimer) clearInterval(workerTimer);
  if (reminderTimer) clearInterval(reminderTimer);
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch (_) { return false; }
}

module.exports = {
  getSystemEmailSettings, getPendingEmailCount, getPendingEmails, getGlobalIdentity, getEventIdentity,
  setSystemEmailEnabled, setEventEmailEnabled, canQueueEmail, enqueueEmail,
  queueAccountRequested, queueAccountApproved, queueImportedAccount, queueImportedRegistration,
  createImportBatch, getImportBatchEmailSummary, authorizeImportBatch,
  queueCertificateIssued, queueVideoLinkNotifications, queueDueEventReminders,
  createSetupToken, startEmailWorkers, stopEmailWorkers, isValidHttpUrl, appBaseUrl
};
