const crypto = require('crypto');

const TOKEN_LENGTH = 32;
const HEADER_NAME = 'X-CSRF-Token';
const FIELD_NAME = '_csrf';
const COOKIE_NAME = 'csrf-token';

function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
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

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      const submitted = req.body && req.body[FIELD_NAME];
      const headerToken = req.headers[HEADER_NAME.toLowerCase()];
      const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
      const actualToken = submitted || headerToken || cookieToken;

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
  }

  next();
}

function csrfTokenGenerator(req, res) {
  return req.session && req.session.csrfToken ? req.session.csrfToken : '';
}

module.exports = { csrfProtection, csrfTokenGenerator, generateToken, HEADER_NAME, FIELD_NAME, COOKIE_NAME };
