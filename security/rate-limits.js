const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' }
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de cadastro. Aguarde 1 hora antes de tentar novamente.' }
});

// Salvar interesses é ação de baixo risco gravada a cada clique do checkbox
// (auto-save); o teto alto por usuário evita 429 em eventos com muitas atividades.
const interestsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas alterações de interesse. Aguarde alguns minutos antes de tentar novamente.' }
});

// Marcar/desmarcar inscrição em minicurso pela página do evento (auto-save via fetch);
// teto alto para evitar 429 em uso normal, baixo o suficiente para conter abuso.
const activityEnrollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas alterações de inscrição em atividades. Aguarde alguns minutos antes de tentar novamente.' }
});

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde antes de tentar novamente.' }
});

module.exports = { loginLimiter, registrationLimiter, interestsLimiter, activityEnrollLimiter, defaultLimiter, adminLimiter, strictLimiter };
