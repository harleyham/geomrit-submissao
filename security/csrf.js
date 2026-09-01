const crypto = require('crypto');
const fs = require('fs');

const TOKEN_LENGTH = 32;
const HEADER_NAME = 'X-CSRF-Token';
const FIELD_NAME = '_csrf';

function removeRejectedUploads(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === 'object') Object.values(req.files).forEach((items) => files.push(...items));
  files.forEach((file) => {
    if (!file || !file.path) return;
    try { fs.unlinkSync(file.path); } catch (error) {
      if (error.code !== 'ENOENT') console.error('Falha ao remover upload rejeitado por CSRF:', error.message);
    }
  });
}

function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

function isCsrfTokenPresentAndValid(req, actualToken) {
  if (!actualToken) return false;
  const sessionToken = req.session && req.session.csrfToken;
  // timingSafeEqual lança TypeError quando os buffers têm comprimentos
  // diferentes; normalizamos o tamanho e capturamos a exceção para que uma
  // discordância resulte sempre em false e nunca em 500.
  const sessionBuf = Buffer.from(String(sessionToken));
  const providedBuf = Buffer.from(String(actualToken));
  let valid = false;
  try {
    if (sessionBuf.length === providedBuf.length) {
      valid = crypto.timingSafeEqual(sessionBuf, providedBuf);
    }
  } catch (e) {
    valid = false;
  }
  return valid;
}

// Valida o token CSRF a partir do header X-CSRF-Token ou do body _csrf,
// ignorando o cookie csrf_token (mesma proteção de bypass descrita abaixo).
// Retorna true quando válido (e chama next), ou responde 403 e NÃO chama next.
function validateCsrfToken(req, res, next) {
  const headerToken = req.headers[HEADER_NAME.toLowerCase()];
  const bodyToken = req.body ? req.body[FIELD_NAME] : null;
  const actualToken = headerToken || bodyToken;

  if (isCsrfTokenPresentAndValid(req, actualToken)) {
    return next();
  }

  removeRejectedUploads(req);
  return res.status(403).render('error', {
    title: 'Solicitação inválida',
    message: actualToken
      ? 'O token de segurança não é válido. Recarregue a página e tente novamente.'
      : 'O token de segurança não foi fornecido. Recarregue a página e tente novamente.'
  });
}

function csrfProtection(req, res, next) {
  if (!req.session) {
    req.session = {};
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }

  const token = req.session.csrfToken;

  res.locals.csrfToken = token;

  // bodies multipart/form-data são parseados pelo multer configurado como
  // middleware de rota, que roda APÓS esta middleware global. Nessa fase o
  // req.body ainda não contém o field _csrf, então a validação CSRF dessas
  // requisições é adiada para o `validateCsrfToken` posicionado logo após o
  // upload (ver `validateCsrfToken` nas rotas de upload).
  if (req.method === 'POST' && req.is('multipart/form-data')) {
    return next();
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    // O token só pode vir do header X-CSRF-Token ou do body _csrf.
    // NUNCA do cookie csrf_token: o navegador o envia automaticamente em
    // navegações top-level cross-site (sameSite: lax), o que permitiria um
    // atacante submeter um formulário para a vítima logada com o "token
    // correto" apenas pelo cookie (bypass de CSRF).
    return validateCsrfToken(req, res, next);
  }

  next();
}

function csrfTokenGenerator(req, res) {
  return req.session && req.session.csrfToken ? req.session.csrfToken : '';
}

module.exports = { csrfProtection, validateCsrfToken, csrfTokenGenerator, generateToken, HEADER_NAME, FIELD_NAME };
