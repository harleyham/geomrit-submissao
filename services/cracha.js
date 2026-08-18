const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { db } = require('../db');
const { drawEventLogo } = require('./event-logo');

const QR_TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateQrToken() {
  const bytes = crypto.randomBytes(10);
  let token = '';
  for (let i = 0; i < 10; i += 1) token += QR_TOKEN_ALPHABET[bytes[i] % QR_TOKEN_ALPHABET.length];
  return token;
}

function ensureEventQrToken(eventId, userId) {
  const existing = db.prepare('SELECT token FROM event_qr_codes WHERE event_id=? AND user_id=?').get(eventId, userId);
  if (existing) return existing.token;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateQrToken();
    try {
      db.prepare('INSERT INTO event_qr_codes (event_id,user_id,token) VALUES (?,?,?)').run(eventId, userId, token);
      return token;
    } catch (err) {
      if (String(err.message || '').includes('event_qr_codes.token')) continue;
      break;
    }
  }
  const row = db.prepare('SELECT token FROM event_qr_codes WHERE event_id=? AND user_id=?').get(eventId, userId);
  return row ? row.token : generateQrToken();
}

function getEventQrRoles(eventId, userId) {
  const roles = db.prepare('SELECT role FROM event_user_roles WHERE event_id=? AND user_id=?').all(eventId, userId).map((row) => row.role);
  const reviewer = db.prepare(`SELECT 1 FROM assignments ass JOIN articles ar ON ar.id=ass.article_id WHERE ar.event_id=? AND ass.reviewer_id=? LIMIT 1`).get(eventId, userId);
  if (reviewer) roles.push('reviewer');
  return [...new Set(roles)].filter((role) => role !== 'admin');
}

const QR_ROLE_LABELS = { participant: 'Participante', reviewer: 'Revisor', speaker: 'Palestrante', teacher: 'Professor(a)', oral_presenter: 'Apresentador Oral', poster_presenter: 'Apresentador Pôster' };

// Crachá em PDF (mesmo padrão de checkin-print/attendance-print).
// `registration` pode ser nulo (usuário com apenas papel no evento); nesse caso o nome vem de `nameFallback`.
async function renderCrachaPdf(res, { event, registration, roles, token, nameFallback }) {
  const QRCode = require('qrcode');
  const qrBuffer = await QRCode.toBuffer(token, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const personName = (registration && registration.name) || nameFallback || 'Participante';
  const displayRoles = [...new Set([...(registration ? ['participant'] : []), ...roles])].map((role) => QR_ROLE_LABELS[role] || role);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="cracha-${event.id}-${encodeURIComponent(personName)}.pdf"`);
  doc.pipe(res);
  doc.on('error', (err) => { console.error('cracha pdf error:', err && err.message); });

  const cardW = 420;
  const cardH = 600;
  const cardX = (doc.page.width - cardW) / 2;
  const cardY = 120;
  doc.roundedRect(cardX, cardY, cardW, cardH, 12).lineWidth(1.5).strokeColor('#0f172a').stroke();

  let y = cardY + 24;
  const hasLogo = drawEventLogo(doc, event, { x: cardX + 30, y, width: cardW - 60, height: 46 });
  if (hasLogo) {
    y += 46 + 12;
  } else {
    y = cardY + 36;
  }
  doc.fontSize(17).font('Helvetica-Bold').fillColor('#0f172a').text(event.name, cardX + 30, y, { width: cardW - 60, align: 'center' });
  y = doc.y + 10;
  doc.moveTo(cardX + 30, y).lineTo(cardX + cardW - 30, y).lineWidth(1).strokeColor('#cbd5e1').stroke();
  y += 20;
  doc.fontSize(15).font('Helvetica-Bold').fillColor('#0f172a').text(personName, cardX + 30, y, { width: cardW - 60, align: 'center' });
  y = doc.y + 6;
  if (registration && registration.institution) {
    doc.fontSize(11).font('Helvetica').fillColor('#334155').text(registration.institution, cardX + 30, y, { width: cardW - 60, align: 'center' });
    y = doc.y + 4;
  }
  if (displayRoles.length > 0) {
    doc.fontSize(11).font('Helvetica').fillColor('#334155').text(displayRoles.join(' · '), cardX + 30, y, { width: cardW - 60, align: 'center' });
    y = doc.y + 20;
  }
  const qrSize = hasLogo ? 216 : 240;
  const qrX = cardX + (cardW - qrSize) / 2;
  doc.image(qrBuffer, qrX, y, { width: qrSize, height: qrSize });
  y += qrSize + 22;
  doc.font('Courier-Bold').fontSize(18).fillColor('#0f172a').text(token, cardX, y, { width: cardW, align: 'center', characterSpacing: 5 });
  y = doc.y + 12;
  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text('Apresente este código na chamada das atividades. Válido apenas para este evento e sem acesso à sua conta.', cardX + 40, y, { width: cardW - 80, align: 'center' });
  doc.end();
}

module.exports = { QR_ROLE_LABELS, ensureEventQrToken, getEventQrRoles, renderCrachaPdf };
