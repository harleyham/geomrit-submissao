const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Página inicial - lista eventos
router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT * FROM events WHERE status = 'published' ORDER BY date_start DESC
  `).all();
  res.render('public/home', { events, title: 'Eventos LIGEM.Redes' });
});

// Detalhes do evento
router.get('/evento/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND status = "published"').get(req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('public/event', { event, title: event.name });
});

// Formulário de submissão
router.get('/submeter/:eventId', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND status = "published"').get(req.params.eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('public/submit', { event, title: 'Submeter Artigo' });
});

// Processar submissão de artigo
router.post('/submeter/:eventId', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND status = "published"').get(req.params.eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

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
  `).run(
    event.id, title, title_en || '', area || event.area, authors, 
    abstract || '', keywords || '', contributor || '', affiliation || '', 
    city || '', email_submission || '', access_code, type
  );
  
  // Gerar código de acesso para login do revisor (se aplicável) ou consulta
  res.render('public/submit', {
    event, 
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
  `).get(access_code);
  
  if (!article) {
    return res.render('public/consultar', { article: null, error: 'Código de acesso inválido.', title: 'Consultar Artigo' });
  }
  
  res.render('public/consultar', { article, error: null, title: 'Artigo Encontrado' });
});

// Página de revisores
router.get('/revisores', (req, res) => {
  const reviewers = db.prepare(`
    SELECT r.*, COUNT(DISTINCT a.id) as article_count
    FROM reviewers r
    LEFT JOIN assignments ass ON ass.reviewer_id = r.id
    LEFT JOIN articles a ON a.id = ass.article_id
    WHERE r.is_active = 1
    GROUP BY r.id
    ORDER BY r.area, r.name
  `).all();

  const areas = [...new Set(reviewers.map(r => r.area))].sort();
  res.render('public/reviewers', { reviewers, areas, title: 'Corpo de Revisores' });
});

module.exports = router;