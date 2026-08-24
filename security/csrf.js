const crypto = require('crypto');

const TOKEN_LENGTH = 32;
const HEADER_NAME = 'X-CSRF-Token';
const FIELD_NAME = '_csrf';

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
    // O token só pode vir do header X-CSRF-Token ou do body _csrf.
    // NUNCA do cookie csrf_token: o navegador o envia automaticamente em
    // navegações top-level cross-site (sameSite: lax), o que permitiria um
    // atacante submeter um formulário para a vítima logada com o "token
    // correto" apenas pelo cookie (bypass de CSRF).
    const headerToken = req.headers[HEADER_NAME.toLowerCase()];
    const bodyToken = req.body ? req.body[FIELD_NAME] : null;

    const actualToken = headerToken || bodyToken;

    if (!actualToken) {
      return res.status(403).render('error', {
        title: 'Solicitação inválida',
        message: 'O token de segurança não foi fornecido. Recarregue a página e tente novamente.'
      });
    }

    // timingSafeEqual lança TypeError quando os buffers têm comprimentos
    // diferentes; normalizamos o tamanho e capturamos a exceção para que uma
    // discordância de resulte sempre em 403 e nunca em 500.
    const sessionBuf = Buffer.from(String(token));
    const providedBuf = Buffer.from(String(actualToken));
    let valid = false;
    try {
      if (sessionBuf.length === providedBuf.length) {
        valid = crypto.timingSafeEqual(sessionBuf, providedBuf);
      }
    } catch (e) {
      valid = false;
    }

    if (!valid) {
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

module.exports = { csrfProtection, csrfTokenGenerator, generateToken, HEADER_NAME, FIELD_NAME };
