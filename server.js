const express = require('express');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const methodOverride = require('method-override');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Segurança e performance
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
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

app.use(session({
  secret: process.env.SESSION_SECRET || 'edigemia-ligem-secret-2027',
  resave: false,
  saveUninitialized: false,
}));

// Multer para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Dados globais para templates
app.use((req, res, next) => {
  res.locals.isAdmin = req.session && req.session.isAdmin;
  res.locals.adminUsername = req.session && req.session.adminUsername;
  res.locals.url = req.originalUrl;
  res.locals.year = new Date().getFullYear();
  next();
});

// Importar rotas
const { router: authRouter, requireAuth } = require('./routes/auth');
const eventsRouter = require('./routes/events');
const articlesRouter = require('./routes/articles');
const reviewersRouter = require('./routes/reviewers');
const assignmentsRouter = require('./routes/assignments');
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
app.use('/admin/reviewers', requireAuth, reviewersRouter);
app.use('/admin/assignments', requireAuth, assignmentsRouter);
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