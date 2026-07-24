const express = require('express');
const router = express.Router();
const { db, getAssignmentsByEvent, getPendingReviews, getReviewedArticles } = require('../db');

// Dashboard do revisor (após login com email)
router.get('/reviewer', (req, res) => {
  const email = req.query.email;
  if (!email) return res.redirect('/');
  const reviewer = db.prepare('SELECT * FROM reviewers WHERE email = ? AND is_active = 1').get(email);
  if (!reviewer) return res.status(404).render('error', { title: 'Revisor não encontrado' });
  
  const pending = getPendingReviews(reviewer.id);
  const reviewed = getReviewedArticles(reviewer.id);
  
  res.render('reviewer/dashboard', { reviewer, pending, reviewed, title: 'Painel do Revisor' });
});

// Formulário de relatório
router.get('/reviewer/:assignmentId', (req, res) => {
  const assignment = db.prepare(`
    SELECT a.*, r.name as reviewer_name, e.name as event_name
    FROM assignments a
    JOIN articles art ON art.id = a.article_id
    JOIN reviewers r ON r.id = a.reviewer_id
    JOIN events e ON e.id = art.event_id
    WHERE a.id = ?
  `).get(req.params.assignmentId);
  
  if (!assignment) return res.status(404).render('error', { title: 'Atribuição não encontrada' });
  
  const report = db.prepare('SELECT * FROM reports WHERE assignment_id = ?').get(req.params.assignmentId);
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(assignment.article_id);
  
  res.render('reviewer/report', { assignment, report, article, title: 'Relatório' });
});

// Salvar relatório
router.post('/reviewer/:assignmentId', (req, res) => {
  const { score, report, recommendation } = req.body;
  const assignmentId = parseInt(req.params.assignmentId);
  
  db.prepare(`
    INSERT INTO reports (assignment_id, score, report, recommendation, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(assignment_id) DO UPDATE SET
      score=excluded.score, report=excluded.report, recommendation=excluded.recommendation, updated_at=datetime('now')
  `).run(assignmentId, score || null, report || '', recommendation || '');
  
  res.redirect(`/admin/reports/reviewer?email=${req.body.reviewer_email}`);
});

// Painel admin - relatórios do evento
router.get('/', (req, res) => {
  const eventId = parseInt(req.query.eventId);
  if (!eventId) return res.redirect('/admin');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const assignments = getAssignmentsByEvent(eventId);
  
  // Calcular decisão final
  assignments.forEach(a => {
    if (a.report_id) {
      // Decisão final: maioria das recomendações
      const approvals = assignments.filter(x => x.report_id && x.recommendation === 'approved').length;
      const rejections = assignments.filter(x => x.report_id && x.recommendation === 'rejected').length;
      const revisions = assignments.filter(x => x.report_id && x.recommendation === 'revision_requested').length;
      
      a.final_recommendation = approvals > rejections && approvals > revisions ? 'approved' :
                                rejections > approvals && rejections > revisions ? 'rejected' : 'revision_requested';
    }
  });
  
  res.render('admin/reports/list', { event, assignments, title: 'Relatórios - ' + event.name });
});

// Decidir destino do artigo (admin)
router.post('/:id/decide', (req, res) => {
  const { final_status, eventId } = req.body;
  db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now") WHERE id = ?').run(final_status, req.params.id);
  res.redirect(`/admin/reports?eventId=${eventId}`);
});

module.exports = router;