const express = require('express');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');
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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

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

// Roteamento
app.use('/login', authRouter);

// Rotas públicas
app.use('/', publicRouter);

// Rotas admin
app.use('/admin', requireAuth);
app.use('/admin/events', requireAuth, eventsRouter);
app.use('/admin/articles', requireAuth, articlesRouter);
app.use('/admin/reviewers', requireAuth, reviewersRouter);
app.use('/admin/assignments', requireAuth, assignmentsRouter);
app.use('/admin/reports', requireAuth, reportsRouter);

// Rota de download de arquivos
app.get('/download/:filename', (req, res) => {
  const filepath = path.join(__dirname, 'uploads', req.params.filename);
  res.download(filepath);
});

// Rotas públicas do revisor
const reviewerRoutes = require('./routes/reviewer');
app.use('/reviewer', reviewerRoutes);

// Submissão pública de artigo (nova rota)
app.post('/events/:eventId/submit', upload.single('pdf'), async (req, res) => {
  const { eventId } = req.params;
  const { title, title_en, area, authors, abstract, keywords, email_submission, contributor, affiliation, city } = req.body;
  
  if (!title || !authors || !abstract || !keywords || !email_submission) {
    const events = await db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    const areas = events ? events.area.split(',').map(a => a.trim()) : ['Processamento de Linguagem Natural', 'Computação Cognitiva', 'Redes Neurais', 'Aprendizado Profundo', 'Outra'];
    return res.status(400).render('public/event', {
      event: events,
      areas,
      year: new Date().getFullYear(),
      submissionError: 'Campos obrigatórios não preenchidos.'
    });
  }
  
  if (req.file) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newFilename = unique + ext;
    const fs = require('fs');
    fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newFilename));
    req.file.filename = newFilename;
  }
  
  // Gerar código de acesso
  const accessCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  
  const stmt = db.prepare(`
    INSERT INTO articles (event_id, title, title_en, area, authors, abstract, keywords, pdf_path, contributor, affiliation, city, email_submission, access_code, status, date_submitted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `);
  
  stmt.run(
    eventId,
    title,
    title_en || '',
    area || 'Outra',
    authors,
    abstract,
    keywords,
    req.file ? req.file.filename : null,
    contributor || '',
    affiliation || '',
    city || '',
    email_submission,
    accessCode
  );
  
  res.render('public/event', {
    event: { id: eventId, name: 'Evento', area: area || 'Outra', status: 'open', description: '' },
    areas: ['Processamento de Linguagem Natural', 'Computação Cognitiva', 'Redes Neurais', 'Aprendizado Profundo', 'Outra'],
    year: new Date().getFullYear(),
    submissionSuccess: true,
    submissionCode: accessCode
  });
});

// Consultar artigo publicamente
app.get('/article/:id', async (req, res) => {
  const { id } = req.params;
  const article = await db.prepare(`
    SELECT a.*, e.name as event_name, e.date_start as event_date_start
    FROM articles a LEFT JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `).get(id);
  
  if (!article) {
    return res.render('public/article', {
      article: null,
      error: 'Artigo não encontrado.',
      year: new Date().getFullYear()
    });
  }
  
  res.render('public/article', { article, year: new Date().getFullYear() });
});

// View de evento público
app.get('/events/:id', async (req, res) => {
  const { id } = req.params;
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  
  if (!event) {
    return res.redirect('/');
  }
  
  const areas = event.area.split(',').map(a => a.trim());
  
  res.render('public/event', {
    event,
    areas,
    year: new Date().getFullYear()
  });
});

// Upload de artigo (público - legado)
app.post('/submit', upload.single('article_file'), (req, res) => {
  const { event_id, title, authors, abstract, article_type, submitted_email } = req.body;
  if (!event_id || !title || !authors) {
    return res.status(400).json({ error: 'Campos obrigatórios: event_id, title, authors' });
  }
  const stmt = db.prepare(`
    INSERT INTO articles (event_id, title, authors, abstract, type, file_path, file_original_name, submitted_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    event_id,
    title,
    authors,
    abstract || '',
    article_type,
    req.file ? req.file.filename : null,
    req.file ? req.file.originalname : null,
    submitted_email || ''
  );
  res.json({ success: true, message: 'Artigo submetido com sucesso!' });
});

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