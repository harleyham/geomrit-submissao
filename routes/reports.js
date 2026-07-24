const express = require('express');
const router = express.Router();
const { db, getAssignmentsByEvent, getPendingReviews, getReviewedArticles } = require('../db');

// Middleware de autenticação admin para relatórios
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Painel admin - relatórios do evento
router.get('/', requireAuth, (req, res) => {
  const eventId = parseInt(req.query.eventId);
  if (!eventId) return res.redirect('/admin');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  
  const assignments = getAssignmentsByEvent(eventId);
  
  // Calcular decisão final por artigo com base nos relatórios dos revisores
  const articleDecisions = {};
  assignments.forEach(a => {
    if (!articleDecisions[a.id]) {
      articleDecisions[a.id] = {
        article: a,
        approvals: 0,
        rejections: 0,
        revisions: 0,
        total_reports: 0
      };
    }
    if (a.report_id) {
      articleDecisions[a.id].total_reports++;
      if (a.recommendation === 'approved') articleDecisions[a.id].approvals++;
      else if (a.recommendation === 'rejected') articleDecisions[a.id].rejections++;
      else if (a.recommendation === 'revision_requested') articleDecisions[a.id].revisions++;
    }
  });
  
  // Determinar decisão final
  Object.values(articleDecisions).forEach(dec => {
    const { approvals, rejections, revisions } = dec;
    if (dec.total_reports === 0) {
      dec.final_recommendation = 'pending';
    } else if (approvals > rejections && approvals > revisions) {
      dec.final_recommendation = 'approved';
    } else if (rejections > approvals && rejections > revisions) {
      dec.final_recommendation = 'rejected';
    } else {
      dec.final_recommendation = 'revision_requested';
    }
    dec.final_recommendation_label = {
      'approved': 'Aprovado',
      'rejected': 'Rejeitado',
      'revision_requested': 'Revisão Solicitada',
      'pending': 'Pendente'
    }[dec.final_recommendation] || dec.final_recommendation;
  });
  
  res.render('admin/reports/list', { 
    event, 
    articleDecisions: Object.values(articleDecisions),
    title: 'Relatórios - ' + event.name 
  });
});

// Decidir destino do artigo (admin)
router.post('/:id/decide', requireAuth, (req, res) => {
  const { final_status, eventId } = req.body;
  if (final_status) {
    db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now") WHERE id = ?').run(final_status, req.params.id);
  }
  res.redirect(`/admin/reports?eventId=${eventId}`);
});

module.exports = router;