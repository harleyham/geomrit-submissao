const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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
  const certificateBody = certificate.certificate_body || `participou do evento ${certificate.event_name}.`;
  document.fillColor(textColor).font('Helvetica-Bold').fontSize(30).text(certificateTitle, 55, 105, { width: width - 110, align: 'center' });
  document.fillColor(textColor).font('Helvetica').fontSize(16).text('Certificamos que', 80, 205, { width: width - 160, align: 'center' });
  document.fillColor(textColor).font('Helvetica-Bold').fontSize(27).text(certificate.participant_name, 80, 240, { width: width - 160, align: 'center' });

  document.fillColor(textColor).font('Helvetica').fontSize(15).text(certificateBody, 80, 300, { width: width - 160, align: 'center' });

  const dateLabel = certificate.event_date_end && certificate.event_date_end !== certificate.event_date_start
    ? `Realizado de ${certificate.event_date_start} a ${certificate.event_date_end}.`
    : certificate.event_date_start ? `Realizado em ${certificate.event_date_start}.` : '';
  document.fontSize(12).fillColor(textColor).text(dateLabel, 80, 335, { width: width - 160, align: 'center' });

  const workloadHours = Number(certificate.total_workload_hours);
  if (Number.isFinite(workloadHours) && workloadHours > 0) {
    const formattedHours = Number.isInteger(workloadHours)
      ? String(workloadHours)
      : workloadHours.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const hourLabel = workloadHours === 1 ? 'hora-aula' : 'horas-aula';
    document.fillColor(textColor).font('Helvetica').fontSize(10).text(
      `Carga horária: ${formattedHours} ${hourLabel}.`,
      80,
      360,
      { width: width - 160, align: 'center' }
    );
  }

  if (certificate.activities_summary) {
    document.fillColor(textColor).font('Helvetica').fontSize(9).text(
      `Atividades: ${certificate.activities_summary}.`,
      80,
      382,
      { width: width - 160, align: 'center', ellipsis: true }
    );
  }

  document.fontSize(10).fillColor(textColor).text(`Código de verificação: ${certificate.certificate_code} · Emissão: ${certificate.issued_at}`, 80, height - 75, { width: width - 160, align: 'center' });
  document.end();
}

module.exports = { getBackgroundPath, renderCertificatePdf };
