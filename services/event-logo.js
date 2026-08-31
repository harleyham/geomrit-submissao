const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// Resolve o caminho absoluto do logo do evento a partir do `logo_path`
// (ex.: 'uploads/event-logos/123-abc.png'). Retorna null se inexistente/inválido.
function getEventLogoAbsPath(event) {
  const logoPath = event && event.logo_path ? String(event.logo_path).replace(/\\/g, '/') : '';
  if (!logoPath.startsWith('uploads/event-logos/')) return null;
  const filename = logoPath.slice('uploads/event-logos/'.length);
  if (!filename || filename !== path.posix.basename(filename)) return null;
  const abs = path.join(rootDir, 'uploads', 'event-logos', filename);
  return fs.existsSync(abs) ? abs : null;
}

// Remove o arquivo do logo do evento (ignora falhas).
function removeEventLogoFile(logoPath) {
  const abs = getEventLogoAbsPath(logoPath ? { logo_path: logoPath } : null);
  if (abs) {
    try { fs.unlinkSync(abs); } catch (_) {}
  }
}

// Desenha o logo centralizado dentro de uma caixa (mantendo proporção).
// Retorna true se o logo foi desenhado; o cursor do documento não é alterado.
function drawEventLogo(doc, event, { x, y, width, height }) {
  const logoAbs = getEventLogoAbsPath(event);
  if (!logoAbs) return false;
  try {
    doc.image(logoAbs, x, y, { fit: [width, height], align: 'center', valign: 'center' });
    return true;
  } catch (err) {
    console.error('Erro ao renderizar o logo do evento no PDF:', err && err.message);
    return false;
  }
}

module.exports = { getEventLogoAbsPath, removeEventLogoFile, drawEventLogo };
