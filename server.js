const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const methodOverride = require('method-override');
const crypto = require('crypto');

const { csrfProtection } = require('./security/csrf');
const { defaultLimiter, adminLimiter } = require('./security/rate-limits');
const { handleValidationErrors } = require('./security/validation');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = 'V0.1';

const isProduction = process.env.NODE_ENV === 'production';

// Segurança e performance
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: isProduction ? [] : ["'self'", 'blob:'],
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

// Middleware
app.use(methodOverride('_method'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

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
  next();
});

// Importar rotas
const { router: authRouter, requireAuth, requireOnboarding } = require('./routes/auth');
const eventsRouter = require('./routes/events');
const articlesRouter = require('./routes/articles');
const usersRouter = require('./routes/users');
const reportsRouter = require('./routes/reports');
const publicRouter = require('./routes/public');
const reviewerRoutes = require('./routes/reviewer');

// Roteamento
app.use('/login', authRouter);

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
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
