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
  document.fillColor(textColor).font('Helvetica-Bold').fontSize(30).text('CERTIFICADO DE PARTICIPAÇÃO', 55, 105, { width: width - 110, align: 'center' });
  document.fillColor(textColor).font('Helvetica').fontSize(16).text('Certificamos que', 80, 205, { width: width - 160, align: 'center' });
  document.fillColor(textColor).font('Helvetica-Bold').fontSize(27).text(certificate.participant_name, 80, 240, { width: width - 160, align: 'center' });

  let bodyText = `participou do evento ${certificate.event_name}.`;
  document.fillColor(textColor).font('Helvetica').fontSize(15).text(bodyText, 80, 300, { width: width - 160, align: 'center' });

  const dateLabel = certificate.event_date_end && certificate.event_date_end !== certificate.event_date_start
    ? `Realizado de ${certificate.event_date_start} a ${certificate.event_date_end}.`
    : certificate.event_date_start ? `Realizado em ${certificate.event_date_start}.` : '';
  document.fontSize(12).fillColor(textColor).text(dateLabel, 80, 335, { width: width - 160, align: 'center' });

  if (certificate.activities_attended && Number(certificate.activities_attended) > 0) {
    let activitiesText = '';
    if (Number(certificate.activities_attended) > 1) {
      activitiesText = `${certificate.activities_attended} atividades · Carga horária total: ${certificate.total_workload_hours || 0}h`;
    } else {
      activitiesText = `${certificate.activities_attended} atividade · Carga horária total: ${certificate.total_workload_hours || 0}h`;
    }
    document.fillColor(textColor).font('Helvetica').fontSize(10).text(activitiesText, 80, 360, { width: width - 160, align: 'center' });
  }

  document.fontSize(10).fillColor(textColor).text(`Código de verificação: ${certificate.certificate_code} · Emissão: ${certificate.issued_at}`, 80, height - 75, { width: width - 160, align: 'center' });
  document.end();
}

module.exports = { renderCertificatePdf };
