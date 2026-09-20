const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { db } = require('../db');

const rootDir = path.join(__dirname, '..');

function getBackgroundPath(filePath) {
  if (!filePath) return null;
  const safePath = String(filePath).replace(/\\/g, '/');
  if (safePath.startsWith('certificate-backgrounds/')) {
    const filename = safePath.slice('certificate-backgrounds/'.length);
    if (filename !== path.posix.basename(filename)) return null;
    return path.join(rootDir, 'uploads', 'certificate-backgrounds', filename);
  }
  if (safePath.startsWith('uploads/certificate-backgrounds/')) {
    const filename = safePath.slice('uploads/certificate-backgrounds/'.length);
    if (filename !== path.posix.basename(filename)) return null;
    return path.join(rootDir, 'uploads', 'certificate-backgrounds', filename);
  }
  if (safePath.startsWith('assets/Fundos/')) {
    const filename = safePath.slice('assets/Fundos/'.length);
    if (filename !== path.posix.basename(filename)) return null;
    return path.join(rootDir, 'assets', 'Fundos', filename);
  }
  return null;
}

function renderCertificatePdf(res, certificate) {
  const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  document.pipe(res);
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
  const isActivityCertificate = Number(certificate.is_activity_certificate) === 1;
  // Em certificados de atividade o corpo já traz a carga da atividade
  // ("Atividade: X (N hora(s)-aula)."); o adendo automático só vale para os
  // demais certificados, para não exibir a carga duas vezes.
  if (Number.isFinite(workloadHours) && workloadHours > 0 && !isActivityCertificate) {
    const formattedHours = Number.isInteger(workloadHours)
      ? String(workloadHours)
      : workloadHours.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const hourLabel = workloadHours === 1 ? 'hora-aula' : 'horas-aula';
    certificateBody = `${certificateBody} ( ${formattedHours} ${hourLabel} )`;
  }
  document.fillColor(textColor).font('Helvetica-Bold').fontSize(30).text(certificateTitle, 55, 105, { width: width - 110, align: 'center' });
  // O bloco central de texto fica abaixo do meio vertical para não
  // concentrar tudo na metade superior da página.
  const textOffset = Math.round(height * 0.14);
  document.fillColor(textColor).font('Helvetica').fontSize(16).text('Certificamos que', 80, 205 + textOffset - 20, { width: width - 160, align: 'center' });
  document.fillColor(textColor).font('Helvetica-Bold').fontSize(27).text(certificate.participant_name, 80, 240 + textOffset - 20, { width: width - 160, align: 'center' });

  document.fillColor(textColor).font('Helvetica').fontSize(15).text(certificateBody, 80, 300 + textOffset - 15, { width: width - 160, align: 'center' });

  // Certificados de atividade mostram o período da própria atividade; demais
  // certificados usam o período do evento.
  let dateStart = certificate.event_date_start;
  let dateEnd = certificate.event_date_end;
  if (isActivityCertificate && certificate.activity_id) {
    const activity = db.prepare(`SELECT COALESCE(MIN(s.session_date), date_start) AS date_start,
        COALESCE(MAX(s.session_date), date_end) AS date_end
      FROM event_activities ea
      LEFT JOIN activity_sessions s ON s.activity_id = ea.id
      WHERE ea.id = ?`).get(certificate.activity_id);
    if (activity && activity.date_start) { dateStart = activity.date_start; dateEnd = activity.date_end; }
  }
  // Datas no formato brasileiro DD/MM/AAAA (o banco grava AAAA-MM-DD).
  const formatDMY = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
  };
  dateStart = formatDMY(dateStart);
  dateEnd = formatDMY(dateEnd);
  const dateLabel = dateEnd && dateEnd !== dateStart
    ? `Realizado de ${dateStart} a ${dateEnd}.`
    : dateStart ? `Realizado em ${dateStart}.` : '';
  document.fontSize(12).fillColor(textColor).text(dateLabel, 80, 335 + textOffset - 15, { width: width - 160, align: 'center' });

  // Nos certificados por atividade o nome já consta no corpo do certificado;
  // o resumo consolidado só vale para certificados por papel.
  if (certificate.activities_summary && !isActivityCertificate) {
    document.fillColor(textColor).font('Helvetica').fontSize(9).text(
      `Atividades: ${certificate.activities_summary}.`,
      80,
      382 + textOffset - 10,
      { width: width - 160, align: 'center', ellipsis: true }
    );
  }

  document.fontSize(10).fillColor(textColor).text(`Código de verificação: ${certificate.certificate_code} · Emissão: ${formatDMY(certificate.issued_at)}${certificate.issued_at ? String(certificate.issued_at).slice(10) : ''}`, 80, height - 40, { width: width - 160, align: 'center' });
  document.end();
}

module.exports = { getBackgroundPath, renderCertificatePdf };
