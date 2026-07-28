const express = require('express');
const router = express.Router();
const { db } = require('../db');

function getSubmissionWindow(event) {
  const now = new Date();
  const start = event.submission_start ? new Date(`${event.submission_start}T00:00:00`) : null;
  const end = event.submission_end ? new Date(`${event.submission_end}T23:59:59`) : null;

  let isOpen = true;
  let message = null;

  if (start && now < start) {
    isOpen = false;
    message = `As submissões para este evento abrem em ${start.toLocaleDateString('pt-BR')}.`;
  } else if (end && now > end) {
    isOpen = false;
    message = `O período de submissão deste evento encerrou em ${end.toLocaleDateString('pt-BR')}.`;
  }

  return { isOpen, message, start, end };
}

function withSubmissionMeta(event) {
  const submission = getSubmissionWindow(event);
  return { ...event, submission };
}

// Página inicial - lista eventos
router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT * FROM events WHERE status = 'published' ORDER BY date_start DESC
  `).all().map(withSubmissionMeta);
  res.render('public/home', { events, title: 'Eventos LIGEM.Redes' });
});

// Detalhes do evento
router.get('/evento/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND status = "published"').bind(req.params.id).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('public/event', { event: withSubmissionMeta(event), title: event.name });
});

// Formulário de submissão
router.get('/submeter/:eventId', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND status = "published"').bind(req.params.eventId).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const eventWithMeta = withSubmissionMeta(event);
  if (!eventWithMeta.submission.isOpen) {
    return res.render('public/submit', {
      event: eventWithMeta,
      title: 'Submeter Artigo',
      submitted: false,
      submissionError: eventWithMeta.submission.message
    });
  }
  res.render('public/submit', { event: eventWithMeta, title: 'Submeter Artigo' });
});

// Processar submissão de artigo
router.post('/submeter/:eventId', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND status = "published"').bind(req.params.eventId).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const eventWithMeta = withSubmissionMeta(event);
  if (!eventWithMeta.submission.isOpen) {
    return res.status(400).render('public/submit', {
      event: eventWithMeta,
      title: 'Submeter Artigo',
      submitted: false,
      submissionError: eventWithMeta.submission.message
    });
  }

  const {
    title, title_en, area, authors, abstract, keywords,
    contributor, affiliation, city, email_submission
  } = req.body;
  
  const type = req.body.type || 'oral';
  const access_code = 'ACC-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  
  db.prepare(`
    INSERT INTO articles 
    (event_id, title, title_en, area, authors, abstract, keywords, 
     contributor, affiliation, city, email_submission, access_code, type, 
     status, date_submitted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))
   `).bind(
    event.id, title, title_en || '', area || event.area, authors, 
    abstract || '', keywords || '', contributor || '', affiliation || '', 
    city || '', email_submission || '', access_code, type
  ).run();
  
  // Gerar código de acesso para login do revisor (se aplicável) ou consulta
  res.render('public/submit', {
    event: eventWithMeta,
    title: 'Submissão Concluída',
    access_code,
    submitted: true
  });
});

// Consultar artigo por código
router.get('/consultar', (req, res) => {
  res.render('public/consultar', { article: null, error: null, title: 'Consultar Artigo' });
});

router.post('/consultar', (req, res) => {
  const { access_code } = req.body;
  const article = db.prepare(`
    SELECT a.*, e.name as event_name
    FROM articles a
    JOIN events e ON a.event_id = e.id
    WHERE a.access_code = ?
  `).bind(access_code).get();
  
  if (!article) {
    return res.render('public/consultar', { article: null, error: 'Código de acesso inválido.', title: 'Consultar Artigo' });
  }
  
  res.render('public/consultar', { article, error: null, title: 'Artigo Encontrado' });
});

// Página de revisores
router.get('/revisores', (req, res) => {
  const reviewers = db.prepare(`
    SELECT u.id, u.name, u.email, COUNT(DISTINCT a.id) as article_count
    FROM users u
    LEFT JOIN assignments ass ON ass.reviewer_id = u.id
    LEFT JOIN articles a ON a.id = ass.article_id
    WHERE u.is_reviewer = 1 AND u.is_public = 1
    GROUP BY u.id
    ORDER BY u.name
  `).all();

  res.render('public/reviewers', { reviewers, areas: [], title: 'Corpo de Revisores' });
});

module.exports = router;
