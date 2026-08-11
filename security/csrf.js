const crypto = require('crypto');

const TOKEN_LENGTH = 32;
const HEADER_NAME = 'X-CSRF-Token';
const FIELD_NAME = '_csrf';
const COOKIE_NAME = 'csrf_token';

function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const eqIndex = cookie.indexOf('=');
    if (eqIndex === -1) continue;
    const key = cookie.substring(0, eqIndex).trim();
    const value = cookie.substring(eqIndex + 1).trim();
    if (key === name) return decodeURIComponent(value);
  }
  return null;
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
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax' });

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    const headerToken = req.headers[HEADER_NAME.toLowerCase()];
    const bodyToken = req.body ? req.body[FIELD_NAME] : null;
    const cookieToken = getCookieValue(req.headers.cookie, COOKIE_NAME);

    const actualToken = headerToken || bodyToken || cookieToken;

    if (!actualToken) {
      return res.status(403).render('error', {
        title: 'Solicitação inválida',
        message: 'O token de segurança não foi fornecido. Recarregue a página e tente novamente.'
      });
    }

    if (!crypto.timingSafeEqual(
      Buffer.from(String(token)),
      Buffer.from(String(actualToken))
    )) {
      return res.status(403).render('error', {
        title: 'Solicitação inválida',
        message: 'O token de segurança não é válido. Recarregue a página e tente novamente.'
      });
    }
  }

  next();
}

function csrfTokenGenerator(req, res) {
  return req.session && req.session.csrfToken ? req.session.csrfToken : '';
}

module.exports = { csrfProtection, csrfTokenGenerator, generateToken, HEADER_NAME, FIELD_NAME, COOKIE_NAME };
