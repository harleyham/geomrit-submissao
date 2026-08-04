const express = require('express');
const router = express.Router();
const { db, getAssignmentsByEvent, getPendingReviews, getReviewedArticles } = require('../db');
const { strictLimiter } = require('../security/rate-limits');

// Middleware de autenticação admin para relatórios
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Painel admin - relatórios do evento
router.get('/', requireAuth, (req, res) => {
  try {
    const eventId = parseInt(req.query.eventId);
    if (!eventId) return res.redirect('/admin');
    const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).get();
    if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
    
    const assignments = getAssignmentsByEvent(eventId);
  
  // Estatísticas do evento
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_submitted,
      SUM(CASE WHEN status = 'approved' AND type = 'oral' THEN 1 ELSE 0 END) as oral_approved,
      SUM(CASE WHEN status = 'approved' AND type = 'poster' THEN 1 ELSE 0 END) as poster_approved,
      SUM(CASE WHEN status = 'rejected' AND type = 'oral' THEN 1 ELSE 0 END) as oral_rejected,
      SUM(CASE WHEN status = 'rejected' AND type = 'poster' THEN 1 ELSE 0 END) as poster_rejected
    FROM articles
    WHERE event_id = ?
      AND status != 'draft'
  `).bind(eventId).get();

  const totalSubmited = stats.total_submitted || 0;
  const oralApproved = stats.oral_approved || 0;
  const posterApproved = stats.poster_approved || 0;
  const oralRejected = stats.oral_rejected || 0;
  const posterRejected = stats.poster_rejected || 0;
  const authorRegistrations = db.prepare(`
    SELECT COUNT(DISTINCT CASE
      WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
      WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
      ELSE NULL
    END) as count
    FROM articles
    WHERE event_id = ? AND status != 'draft'
  `).bind(eventId).get().count || 0;
  const listenerRegistrations = db.prepare(`
    SELECT COUNT(*) as count
    FROM event_registrations
    WHERE event_id = ? AND registration_type = 'listener'
  `).bind(eventId).get().count || 0;

  // Artigos aprovados separados por tipo
  const articlesOral = db.prepare(`
    SELECT a.id, a.title, a.title_en, a.authors, a.area, a.type, a.contributor, a.affiliation, a.city
    FROM articles a
    WHERE a.event_id = ? AND a.status = 'approved' AND a.type = 'oral'
    ORDER BY a.title
  `).bind(eventId).all();

  const articlesPoster = db.prepare(`
    SELECT a.id, a.title, a.title_en, a.authors, a.area, a.type, a.contributor, a.affiliation, a.city
    FROM articles a
    WHERE a.event_id = ? AND a.status = 'approved' AND a.type = 'poster'
    ORDER BY a.title
  `).bind(eventId).all();

  // Artigos reprovados separados por tipo
  const articlesOralRejected = db.prepare(`
    SELECT
      a.id, a.title, a.title_en, a.authors, a.area, a.type, a.contributor, a.affiliation, a.city,
      GROUP_CONCAT(CASE WHEN rp.recommendation = 'rejected' THEN rp.report END, ' | ') as rejection_reason
    FROM articles a
    LEFT JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE a.event_id = ? AND a.status = 'rejected' AND a.type = 'oral'
    GROUP BY a.id
    ORDER BY a.title
  `).bind(eventId).all();

  const articlesPosterRejected = db.prepare(`
    SELECT
      a.id, a.title, a.title_en, a.authors, a.area, a.type, a.contributor, a.affiliation, a.city,
      GROUP_CONCAT(CASE WHEN rp.recommendation = 'rejected' THEN rp.report END, ' | ') as rejection_reason
    FROM articles a
    LEFT JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE a.event_id = ? AND a.status = 'rejected' AND a.type = 'poster'
    GROUP BY a.id
    ORDER BY a.title
  `).bind(eventId).all();

  const participants = db.prepare(`
    WITH approved_authors AS (
      SELECT
        CASE
          WHEN submitter_user_id IS NOT NULL THEN 'user:' || submitter_user_id
          WHEN email_submission IS NOT NULL AND TRIM(email_submission) != '' THEN 'email:' || LOWER(TRIM(email_submission))
          ELSE NULL
        END as participant_key,
        COUNT(*) as approved_articles
      FROM articles
      WHERE event_id = ?
        AND status = 'approved'
      GROUP BY participant_key
    )
    SELECT
      er.name,
      er.email,
      er.institution,
      er.registration_type,
      COALESCE(aa.approved_articles, 0) as approved_articles,
      CASE
        WHEN COALESCE(aa.approved_articles, 0) > 0 THEN 'Artigo aprovado'
        WHEN er.registration_type = 'listener' THEN 'Participante'
        ELSE 'Inscrito com artigo'
      END as participation_label
    FROM event_registrations er
    LEFT JOIN approved_authors aa
      ON aa.participant_key = CASE
        WHEN er.user_id IS NOT NULL THEN 'user:' || er.user_id
        ELSE 'email:' || LOWER(TRIM(er.email))
      END
    WHERE er.event_id = ?
    ORDER BY
      CASE
        WHEN COALESCE(aa.approved_articles, 0) > 0 THEN 0
        WHEN er.registration_type = 'listener' THEN 2
        ELSE 1
      END,
      er.name COLLATE NOCASE
  `).bind(eventId, eventId).all();

  // Calcular decisão final por artigo com base nos relatórios dos revisores
  const articleDecisions = {};
  assignments.forEach(a => {
    if (!articleDecisions[a.article_id]) {
      articleDecisions[a.article_id] = {
        article: a,
        approvals: 0,
        rejections: 0,
        revisions: 0,
        total_reports: 0
      };
    }
    if (a.report_id) {
      articleDecisions[a.article_id].total_reports++;
      if (a.recommendation === 'approved') articleDecisions[a.article_id].approvals++;
      else if (a.recommendation === 'rejected') articleDecisions[a.article_id].rejections++;
      else if (a.recommendation === 'revision_requested') articleDecisions[a.article_id].revisions++;
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
    totalSubmited,
    oralApproved,
    posterApproved,
    oralRejected,
    posterRejected,
    authorRegistrations,
    listenerRegistrations,
    articlesOral,
    articlesPoster,
    articlesOralRejected,
    articlesPosterRejected,
    participants,
    articleDecisions: Object.values(articleDecisions),
    title: 'Relatórios - ' + event.name 
  });
  } catch (err) {
    console.error('ERROR in reports:', err);
    throw err;
  }
});

// Decidir destino do artigo (admin)
router.post('/:id/decide', requireAuth, strictLimiter, (req, res) => {
  const { final_status, eventId } = req.body;
  if (['pending', 'in_review', 'approved', 'rejected'].includes(final_status)) {
    db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now", "-3 hours") WHERE id = ?').bind(final_status, req.params.id).run();
  }
  res.redirect(`/admin/reports?eventId=${eventId}`);
});

module.exports = router;
