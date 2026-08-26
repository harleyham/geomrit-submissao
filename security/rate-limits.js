const rateLimit = require('express-rate-limit');

// Chave de limitação por IP real da conexão (socket), não por `req.ip`.
// Com `trust proxy` ativo (necessário para cookies Secure atrás do nginx),
// `req.ip` passaria a refletir o `X-Forwarded-For`, que um cliente direto
// pode forjar para rotacionar a chave e contornar os tetos. O endereço do
// socket não é spoofável; com keyGenerator próprio, o express-rate-limit
// também deixa de aplicar a validação ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
function socketKeyGenerator(req) {
  return (req.socket && req.socket.remoteAddress) || req.ip;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketKeyGenerator,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' }
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketKeyGenerator,
  message: { error: 'Muitas tentativas de cadastro. Aguarde 1 hora antes de tentar novamente.' }
});

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketKeyGenerator,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketKeyGenerator,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketKeyGenerator,
  message: { error: 'Muitas requisições. Aguarde antes de tentar novamente.' }
});

module.exports = { loginLimiter, registrationLimiter, defaultLimiter, adminLimiter, strictLimiter };
