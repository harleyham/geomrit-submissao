const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Página inicial - lista eventos
router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT * FROM events WHERE status = 'published' ORDER BY date_start DESC
  `).all();
  res.render('public/index', { events, title: 'Eventos LIGEM.Redes' });
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

router.post('/submeter/:eventId', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  res.render('public/submit', { event, title: 'Submeter Artigo' });
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