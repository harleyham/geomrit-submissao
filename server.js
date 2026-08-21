const express = require('express');
const path = require('path');
const querystring = require('querystring');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const methodOverride = require('method-override');
const crypto = require('crypto');

const { csrfProtection } = require('./security/csrf');
const { defaultLimiter, adminLimiter } = require('./security/rate-limits');
const { handleValidationErrors } = require('./security/validation');
const { db } = require('./db');
const { startEmailWorkers, stopEmailWorkers } = require('./services/email');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const APP_VERSION = 'V0.1';

const isProduction = process.env.NODE_ENV === 'production';

// Segurança e performance
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(compression());

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rate limiting global
app.use(defaultLimiter);

// Middleware: o method-override roda DEPOIS dos parsers de body. Nesta versão do pacote,
// getter por string lê apenas a query (?_method=); para o hidden input _method dos
// formulários (ex.: exclusões via _method=DELETE) é preciso getter por função.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(methodOverride((req) => {
  if (req.body && typeof req.body._method === 'string') {
    return req.body._method;
  }
  const queryIndex = (req.url || '').indexOf('?');
  return queryIndex === -1 ? undefined : querystring.parse(req.url.slice(queryIndex + 1))._method;
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads/event-logos', express.static(path.join(__dirname, 'uploads', 'event-logos')));

// Sessão
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: isProduction ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));

// CSRF
app.use(csrfProtection);

// Helpers de data para templates
function formatBRDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function activityDateRange(activity) {
  const start = activity && activity.date_start;
  const end = activity && activity.date_end;
  if (start && end) {
    if (String(start) === String(end)) return formatBRDate(start);
    return `${formatBRDate(start)} a ${formatBRDate(end)}`;
  }
  if (start) return formatBRDate(start);
  if (end) return formatBRDate(end);
  return 'Data a definir';
}

// Dados globais para templates
app.use((req, res, next) => {
  res.locals.isAdmin = req.session && req.session.isAdmin;
  res.locals.isReviewer = req.session && req.session.isReviewer;
  res.locals.isPublic = req.session && req.session.isPublic;
  res.locals.userId = req.session && req.session.userId;
  res.locals.userName = req.session && req.session.userName;
  res.locals.userEmail = req.session && req.session.userEmail;
  res.locals.userRoles = req.session && req.session.userRoles;
  res.locals.url = req.originalUrl;
  res.locals.year = new Date().getFullYear();
  res.locals.appVersion = APP_VERSION;
  res.locals.csrfToken = req.session && req.session.csrfToken;
  res.locals.formatBRDate = formatBRDate;
  res.locals.activityDateRange = activityDateRange;
  next();
});

// Importar rotas
const { router: authRouter, requireAuth, requireOnboarding, requireActiveAccount } = require('./routes/auth');
const eventsRouter = require('./routes/events');
const articlesRouter = require('./routes/articles');
const usersRouter = require('./routes/users');
const reportsRouter = require('./routes/reports');
const publicRouter = require('./routes/public');
const reviewerRoutes = require('./routes/reviewer');

// Prévia da área do participante: enquanto o admin visualiza um usuário
// (session.previewUserId, gravado em GET /admin/users/:id/participant), as
// rotas públicas agem em nome do usuário pré-visualizado. Qualquer request em
// /admin/* sai da visualização e restaura a identidade real do admin.
const previewTargetQuery = db.prepare('SELECT id, name, email, institution, is_public, is_admin, is_reviewer FROM users WHERE id = ?');
app.use((req, res, next) => {
  const session = req.session;
  if (!session || !session.previewUserId) return next();
  const real = session.realIdentity;
  if (!real) {
    delete session.previewUserId;
    return next();
  }
  const inAdminArea = req.path.startsWith('/admin');
  const realActive = db.prepare('SELECT is_public FROM users WHERE id = ?').get(real.userId);
  if (inAdminArea || !realActive || !realActive.is_public) {
    Object.assign(session, real);
    delete session.previewUserId;
    delete session.realIdentity;
    return next();
  }
  const target = previewTargetQuery.get(session.previewUserId);
  if (!target || !target.is_public) {
    Object.assign(session, real);
    delete session.previewUserId;
    delete session.realIdentity;
    return next();
  }
  if (session.userId !== target.id) {
    session.userId = target.id;
    session.userName = target.name;
    session.userEmail = target.email;
    session.userInstitution = target.institution || '';
    session.isPublic = true;
    session.isAdmin = !!target.is_admin;
    session.isReviewer = !!target.is_reviewer;
    if (res.locals) {
      res.locals.userId = target.id;
      res.locals.userName = target.name;
      res.locals.userEmail = target.email;
      res.locals.isPublic = true;
      res.locals.isAdmin = !!target.is_admin;
      res.locals.isReviewer = !!target.is_reviewer;
    }
  }
  next();
});

// Roteamento
app.use('/login', authRouter);

// Conta inativa (is_public=0) não mantém sessão ativa.
app.use(requireActiveAccount);

// Impede que contas em primeiro acesso contornem as etapas obrigatórias.
app.use(requireOnboarding);

// Rotas públicas
app.use('/', publicRouter);

// Rotas admin
app.use('/admin', authRouter);
app.use('/admin', adminLimiter);
app.use('/admin/events', requireAuth, eventsRouter);
app.use('/admin/articles', requireAuth, articlesRouter);
app.use('/admin/users', requireAuth, usersRouter);
app.use('/admin/reports', requireAuth, reportsRouter);

// Rotas do revisor
app.use('/reviewer', reviewerRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Página não encontrada', message: 'A página solicitada não existe.' });
});

// Erro
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).render('error', { title: 'Conteúdo muito grande', message: 'O conteúdo enviado excede o limite permitido.' });
  }
  console.error(err.stack);
  res.status(500).render('error', { title: 'Erro interno do servidor', message: 'Ocorreu um erro inesperado.' });
});

app.listen(PORT, () => {
  console.log(`Artigos LIGEM rodando em http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/login`);
  startEmailWorkers();
});

function closeDb() {
  try { db.close(); } catch (e) { console.error('Erro ao fechar o banco:', e.message); }
}

function shutdown(signal) {
  console.log(`${signal} recebido, encerrando o servidor...`);
  stopEmailWorkers();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('uncaughtException (reiniciando o processo):', err);
  closeDb();
  process.exit(1);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
