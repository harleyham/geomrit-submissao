const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { db, getArticlesByEvent, recordParticipantAudit } = require('../db');
const { strictLimiter } = require('../security/rate-limits');
const { validateAndHandle, validators: v } = require('../security/validation');

function parseAreaList(areaValue) {
  return String(areaValue || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeArea(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function mapArticleStatusLabel(status) {
  const labels = {
    pending: 'Pendente',
    in_review: 'Em análise',
    approved: 'Aprovado',
    rejected: 'Rejeitado',
    draft: 'Rascunho'
  };
  return labels[status] || status;
}

// Middleware de autenticação admin
function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

// Listar artigos de um evento
router.get('/', requireAuth, (req, res) => {
  const eventId = parseInt(req.query.eventId);
  if (!eventId) return res.redirect('/admin');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).get();
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });
  const filters = {
    area: String(req.query.area || 'all').trim(),
    type: ['all', 'oral', 'poster'].includes(String(req.query.type || 'all').trim()) ? String(req.query.type || 'all').trim() : 'all',
    status: ['all', 'pending', 'in_review', 'approved', 'rejected'].includes(String(req.query.status || 'all').trim()) ? String(req.query.status || 'all').trim() : 'all',
    q: String(req.query.q || '').trim(),
    sort: ['date_desc', 'date_asc', 'title_asc', 'title_desc', 'area_asc', 'area_desc'].includes(String(req.query.sort || 'date_desc').trim()) ? String(req.query.sort || 'date_desc').trim() : 'date_desc'
  };
  const allArticles = getArticlesByEvent(eventId);
  const availableAreas = Array.from(new Set(
    allArticles
      .map((article) => String(article.area || '').trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, 'pt-BR'));
  const normalizedQuery = filters.q.toLowerCase();
  const articles = allArticles.filter((article) => {
    if (filters.area !== 'all' && String(article.area || '').trim() !== filters.area) return false;
    if (filters.type !== 'all' && article.type !== filters.type) return false;
    if (filters.status !== 'all' && article.status !== filters.status) return false;
    if (normalizedQuery && !String(article.title || '').toLowerCase().includes(normalizedQuery)) return false;
    return true;
  }).map((article) => ({
    ...article,
    status_label: mapArticleStatusLabel(article.status)
  }));

  articles.sort((left, right) => {
    switch (filters.sort) {
      case 'date_asc':
        return String(left.created_at || '').localeCompare(String(right.created_at || ''));
      case 'title_asc':
        return String(left.title || '').localeCompare(String(right.title || ''), 'pt-BR');
      case 'title_desc':
        return String(right.title || '').localeCompare(String(left.title || ''), 'pt-BR');
      case 'area_asc':
        return String(left.area || 'ZZZ').localeCompare(String(right.area || 'ZZZ'), 'pt-BR');
      case 'area_desc':
        return String(right.area || '').localeCompare(String(left.area || ''), 'pt-BR');
      case 'date_desc':
      default:
        return String(right.created_at || '').localeCompare(String(left.created_at || ''));
    }
  });

  res.render('admin/articles/list', {
    event,
    articles,
    availableAreas,
    filters,
    totalArticles: allArticles.length,
    filteredCount: articles.length,
    title: 'Artigos - ' + event.name
  });
});

function safeArchiveFileName(value, fallback) {
  const normalized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

// Baixar todos os PDFs submetidos de um evento em um único arquivo ZIP.
router.get('/download-all', requireAuth, (req, res, next) => {
  const eventId = parseInt(req.query.eventId, 10);
  if (!eventId) return res.redirect('/admin/events');

  const event = db.prepare('SELECT id, name, short_name FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).render('error', { title: 'Evento não encontrado' });

  const articles = db.prepare(`
    SELECT id, title, pdf_path, file_original_name
    FROM articles
    WHERE event_id = ?
      AND status != 'draft'
      AND pdf_path IS NOT NULL
      AND TRIM(pdf_path) != ''
    ORDER BY title COLLATE NOCASE, id
  `).all(eventId).filter((article) => {
    const fileName = path.basename(article.pdf_path);
    return fileName === article.pdf_path && fs.existsSync(path.join(__dirname, '..', 'uploads', fileName));
  });

  if (!articles.length) {
    return res.status(404).render('error', {
      title: 'Nenhum arquivo disponível',
      message: 'Este evento não possui artigos submetidos com PDF disponível para download.'
    });
  }

  const archiveName = `${safeArchiveFileName(event.short_name || event.name, 'evento')}-artigos.zip`;
  res.attachment(archiveName);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') next(error);
  });
  archive.on('error', next);
  archive.pipe(res);

  articles.forEach((article, index) => {
    const sourcePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
    const extension = path.extname(article.file_original_name || article.pdf_path) || '.pdf';
    const baseName = safeArchiveFileName(article.title, `artigo-${article.id}`);
    archive.file(sourcePath, {
      name: `${String(index + 1).padStart(3, '0')} - ${baseName}${extension.toLowerCase()}`
    });
  });

  archive.finalize();
});

// Detalhe do artigo
router.get('/:id', requireAuth, (req, res) => {
  const article = db.prepare(`
    SELECT a.*, e.name as event_name, e.area as event_area,
      GROUP_CONCAT(DISTINCT u.name) as assigned_reviewers
    FROM articles a
    JOIN events e ON e.id = a.event_id
    LEFT JOIN assignments ass ON ass.article_id = a.id
    LEFT JOIN users u ON u.id = ass.reviewer_id
    WHERE a.id = ?
    GROUP BY a.id
  `).bind(req.params.id).get();
  if (!article) return res.status(404).render('error', { title: 'Artigo não encontrado' });
  const assignedReviewers = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.institution,
      ass.status as assignment_status,
      ass.reviewed_at,
      rp.recommendation,
      rp.report,
      rp.updated_at as report_updated_at
    FROM assignments ass
    JOIN users u ON u.id = ass.reviewer_id
    LEFT JOIN reports rp ON rp.assignment_id = ass.id
    WHERE ass.article_id = ?
    ORDER BY u.name COLLATE NOCASE
  `).bind(req.params.id).all();

  const assignedReviewerIds = new Set(assignedReviewers.map((reviewer) => reviewer.id));
  const articleArea = normalizeArea(article.area);
  const availableReviewers = db.prepare(`
    SELECT id, name, email, institution, reviewer_areas
    FROM users
    WHERE is_reviewer = 1
      AND is_public = 1
    ORDER BY name COLLATE NOCASE
  `).all().map((reviewer) => {
    const reviewerAreaList = parseAreaList(reviewer.reviewer_areas);
    const normalizedReviewerAreas = reviewerAreaList.map(normalizeArea);
    const matchesArticleArea = !!articleArea && normalizedReviewerAreas.includes(articleArea);

    return {
      ...reviewer,
      reviewer_area_list: reviewerAreaList,
      is_assigned: assignedReviewerIds.has(reviewer.id),
      matches_article_area: matchesArticleArea
    };
  }).sort((left, right) => {
    if (left.is_assigned !== right.is_assigned) return left.is_assigned ? 1 : -1;
    if (left.matches_article_area !== right.matches_article_area) return left.matches_article_area ? -1 : 1;
    return left.name.localeCompare(right.name, 'pt-BR');
  });

  res.render('admin/articles/detail', {
    article,
    assignedReviewers,
    availableReviewers,
    title: article.title,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/:id/final-decision', requireAuth, strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.finalDecision);
}, (req, res) => {
  const articleId = parseInt(req.params.id, 10);
  const eventId = parseInt(req.body.eventId, 10);
  const finalStatus = String(req.body.final_status || '').trim();
  const presentationType = String(req.body.presentation_type || '').trim();

  const article = db.prepare('SELECT id FROM articles WHERE id = ?').bind(articleId).get();
  if (!article) {
    return res.status(404).render('error', { title: 'Artigo não encontrado' });
  }

  if (!['pending', 'in_review', 'approved', 'rejected'].includes(finalStatus)) {
    return res.redirect(`/admin/articles/${articleId}?eventId=${eventId}&error=Status final inválido.`);
  }

  if (!['oral', 'poster'].includes(presentationType)) {
    return res.redirect(`/admin/articles/${articleId}?eventId=${eventId}&error=Tipo de apresentação inválido.`);
  }

  db.prepare(`
    UPDATE articles
    SET status = ?, type = ?, updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `).bind(finalStatus, presentationType, articleId).run();

  return res.redirect(`/admin/articles/${articleId}?eventId=${eventId}&success=Deliberação final atualizada com sucesso.`);
});

// Atualizar status
router.put('/:id', requireAuth, (req, res, next) => {
  validateAndHandle(req, res, next, v.articleUpdate);
}, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE articles SET status = ?, updated_at = datetime("now", "-3 hours") WHERE id = ?').bind(status, req.params.id).run();
  res.json({ success: true });
});

// Download do arquivo
router.get('/:id/download', requireAuth, (req, res) => {
  const article = db.prepare('SELECT pdf_path, file_original_name FROM articles WHERE id = ?').bind(req.params.id).get();
  if (!article || !article.pdf_path) return res.status(404).render('error', { title: 'Arquivo não encontrado' });
  const filePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
  res.download(filePath, article.file_original_name || 'artigo.pdf');
});

// Deletar artigo
router.delete('/:id', requireAuth, (req, res) => {
  const article = db.prepare(`
    SELECT id, event_id, pdf_path, submitter_user_id, email_submission, status
    FROM articles WHERE id = ?
  `).bind(req.params.id).get();
  if (!article) return res.status(404).render('error', { title: 'Artigo não encontrado' });

  const deleteArticle = db.transaction(() => {
    db.prepare('DELETE FROM articles WHERE id = ?').run(article.id);

    // Rascunhos não promovem inscrições para author; removê-los não altera a participação.
    if (article.status === 'draft') return;

    const remainingArticles = db.prepare(`
      SELECT COUNT(*) AS count
      FROM articles
      WHERE event_id = ?
        AND status != 'draft'
        AND (
          (submitter_user_id IS NOT NULL AND submitter_user_id = ?)
          OR LOWER(TRIM(COALESCE(email_submission, ''))) = LOWER(TRIM(?))
        )
    `).get(article.event_id, article.submitter_user_id, article.email_submission || '').count;

    const registration = db.prepare(`
      SELECT id, registration_type
      FROM event_registrations
      WHERE event_id = ?
        AND (
          (user_id IS NOT NULL AND user_id = ?)
          OR LOWER(TRIM(email)) = LOWER(TRIM(?))
        )
      ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, id
      LIMIT 1
    `).get(article.event_id, article.submitter_user_id, article.email_submission || '', article.submitter_user_id);

    if (!registration) return;
    if (remainingArticles > 0) {
      recordParticipantAudit({
        eventId: article.event_id,
        registrationId: registration.id,
        actorUserId: req.session.userId,
        action: 'article_deleted_registration_preserved',
        details: { article_id: article.id, remaining_submitted_articles: remainingArticles }
      });
      return;
    }

    if (registration.registration_type === 'author') {
      db.prepare(`
        UPDATE event_registrations
        SET registration_type = 'listener', updated_at = datetime('now', '-3 hours')
        WHERE id = ?
      `).run(registration.id);
    }
    recordParticipantAudit({
      eventId: article.event_id,
      registrationId: registration.id,
      actorUserId: req.session.userId,
      action: 'article_deleted_registration_demoted_to_listener',
      details: { article_id: article.id, remaining_submitted_articles: 0 }
    });
  });

  deleteArticle();
  if (article.pdf_path) {
    const filePath = path.join(__dirname, '..', 'uploads', article.pdf_path);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  const wantsJson = (req.get('accept') || '').includes('application/json') || req.xhr;
  if (wantsJson) {
    return res.json({ success: true, deletedId: Number(req.params.id) });
  }
  res.redirect('/admin/articles?eventId=' + req.query.eventId);
});

// Atribuir revisor a artigo
router.post('/:id/assign', requireAuth, strictLimiter, (req, res, next) => {
  validateAndHandle(req, res, next, v.assignReviewer);
}, (req, res) => {
  const { reviewer_id, action, eventId } = req.body;
  const article = db.prepare('SELECT status FROM articles WHERE id = ?').bind(req.params.id).get();
  if (!article) {
    return res.status(404).render('error', { title: 'Artigo não encontrado' });
  }
  if (action === 'assign') {
    const existing = db.prepare('SELECT id FROM assignments WHERE article_id = ? AND reviewer_id = ?').bind(req.params.id, reviewer_id).get();
    if (existing) return res.redirect('/admin/articles/' + req.params.id);
    db.prepare("INSERT OR IGNORE INTO assignments (article_id, reviewer_id, status) VALUES (?, ?, 'pending')").bind(req.params.id, reviewer_id).run();
    if (!['approved', 'rejected'].includes(article.status)) {
      db.prepare("UPDATE articles SET status = 'in_review', updated_at = datetime('now', '-3 hours') WHERE id = ?").bind(req.params.id).run();
    }
  } else if (action === 'unassign') {
    db.prepare('DELETE FROM assignments WHERE article_id = ? AND reviewer_id = ?').bind(req.params.id, reviewer_id).run();
    const assignedCount = db.prepare('SELECT COUNT(*) as count FROM assignments WHERE article_id = ?').bind(req.params.id).get().count;
    if (assignedCount === 0 && !['approved', 'rejected'].includes(article.status)) {
      db.prepare("UPDATE articles SET status = 'pending', updated_at = datetime('now', '-3 hours') WHERE id = ?").bind(req.params.id).run();
    }
  }
  res.redirect('/admin/articles/' + req.params.id);
});

module.exports = router;
