const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const rootDir = path.join(__dirname, '..');

function getBackgroundPath(filePath) {
  if (!filePath) return null;
  const safePath = String(filePath).replace(/\\/g, '/');
  if (safePath.startsWith('certificate-backgrounds/')) {
    return path.join(rootDir, 'uploads', safePath);
  }
  if (safePath.startsWith('assets/')) return path.join(rootDir, safePath);
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
  document.fillColor('#172554').font('Helvetica-Bold').fontSize(30).text('CERTIFICADO DE PARTICIPAÇÃO', 55, 105, { width: width - 110, align: 'center' });
  document.fillColor('#334155').font('Helvetica').fontSize(16).text('Certificamos que', 80, 205, { width: width - 160, align: 'center' });
  document.fillColor('#0f172a').font('Helvetica-Bold').fontSize(27).text(certificate.participant_name, 80, 240, { width: width - 160, align: 'center' });
  document.fillColor('#334155').font('Helvetica').fontSize(15).text(`participou do evento ${certificate.event_name}.`, 80, 300, { width: width - 160, align: 'center' });
  const dateLabel = certificate.event_date_end && certificate.event_date_end !== certificate.event_date_start
    ? `Realizado de ${certificate.event_date_start} a ${certificate.event_date_end}.`
    : certificate.event_date_start ? `Realizado em ${certificate.event_date_start}.` : '';
  document.fontSize(12).text(dateLabel, 80, 335, { width: width - 160, align: 'center' });
  document.fontSize(10).fillColor('#475569').text(`Código de verificação: ${certificate.certificate_code} · Emissão: ${certificate.issued_at}`, 80, height - 75, { width: width - 160, align: 'center' });
  document.end();
}

module.exports = { renderCertificatePdf };
