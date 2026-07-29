const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const methodOverride = require('method-override');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = 'V0.1';

// Segurança e performance
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));
app.use(compression());

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'edigemia-ligem-secret-2027',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 horas
    sameSite: 'lax',
  },
}));

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
  next();
});

// Importar rotas
const { router: authRouter, requireAuth } = require('./routes/auth');
const eventsRouter = require('./routes/events');
const articlesRouter = require('./routes/articles');
const usersRouter = require('./routes/users');
const reportsRouter = require('./routes/reports');
const publicRouter = require('./routes/public');
const reviewerRoutes = require('./routes/reviewer');

// Roteamento
app.use('/login', authRouter);

// Rotas públicas
app.use('/', publicRouter);

// Rotas admin
app.use('/admin', authRouter);
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
  console.error(err.stack);
  res.status(500).render('error', { title: 'Erro interno do servidor', message: 'Ocorreu um erro inesperado.' });
});

app.listen(PORT, () => {
  console.log(`Artigos LIGEM rodando em http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/login`);
});

module.exports = app;
