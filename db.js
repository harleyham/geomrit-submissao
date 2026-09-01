const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'artigos.db');

let current = new Database(DB_PATH);

// Habilitar WAL mode para melhor performance
current.pragma('journal_mode = WAL');
current.pragma('foreign_keys = ON');

// Proxy estável: as rotas capturam `db` no carregamento do módulo
// (const { db } = require('../db')). Ao trocar a conexão (reset/restore),
// o proxy continua apontando para a conexão atual, sem quebrar referências.
const db = new Proxy({}, {
  get: (_target, prop) => {
    const value = current[prop];
    return typeof value === 'function' ? value.bind(current) : value;
  },
  set: (_target, prop, value) => {
    current[prop] = value;
    return true;
  }
});

function setDb(connection) {
  current = connection;
}

function getCurrentDb() {
  return current;
}

function closeCurrentDb() {
  if (current && current.open) current.close();
}

const hadParticipantActivityEnrollments = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='participant_activity_enrollments'").get());

const { initializeDbSchema } = require('./services/db-reset');
initializeDbSchema(db);


// Exportar funções úteis
module.exports = {
  db,
  setDb,
  getCurrentDb,
  closeCurrentDb,
  recordParticipantAudit: ({ eventId, registrationId = null, actorUserId = null, action, details = {} }) => {
    db.prepare(`
      INSERT INTO participant_audit_logs (event_id, registration_id, actor_user_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '-3 hours'))
    `).run(
      eventId,
      registrationId,
      actorUserId,
      action,
      JSON.stringify(details)
    );
  },
  getArticlesByEvent: (eventId) => {
    return db.prepare(`
      SELECT a.*, 
        COUNT(DISTINCT r.id) as report_count,
        GROUP_CONCAT(DISTINCT u.name) as assigned_reviewers
      FROM articles a
      LEFT JOIN assignments ass ON ass.article_id = a.id
      LEFT JOIN users u ON u.id = ass.reviewer_id
      LEFT JOIN reports r ON r.assignment_id = ass.id
      WHERE a.event_id = ?
        AND a.status != 'draft'
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `).bind(eventId).all();
  },
  getStatsByEvent: (eventId) => {
    const total = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status != 'draft'").bind(eventId).get().count;
    const pending = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'pending'").bind(eventId).get().count;
    const in_review = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'in_review'").bind(eventId).get().count;
    const approved = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'approved'").bind(eventId).get().count;
    const rejected = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'rejected'").bind(eventId).get().count;
    return { total, pending, in_review, approved, rejected };
  },
  getUnassignedArticles: (eventId) => {
    return db.prepare(`
      SELECT a.* FROM articles a
      WHERE a.event_id = ?
        AND a.status != 'draft'
        AND a.id NOT IN (SELECT DISTINCT article_id FROM assignments)
      ORDER BY a.created_at DESC
    `).bind(eventId).all();
  },
  getArticleById: (articleId) => {
    return db.prepare(`
      SELECT a.*, e.name as event_name, e.area
      FROM articles a
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ?
    `).bind(articleId).get();
  },
  getAssignmentsByEvent: (eventId) => {
    return db.prepare(`
      SELECT 
        a.id as article_id, a.title, a.authors, a.type, a.status,
        ass.id as assignment_id, ass.status as assignment_status,
        u.id as reviewer_id, u.name as reviewer_name,
        rp.id as report_id, rp.score, rp.recommendation
      FROM articles a
      LEFT JOIN assignments ass ON ass.article_id = a.id
      LEFT JOIN users u ON u.id = ass.reviewer_id
      LEFT JOIN reports rp ON rp.assignment_id = ass.id
      WHERE a.event_id = ?
        AND a.status != 'draft'
      ORDER BY a.created_at DESC
    `).bind(eventId).all();
  },
  getPendingReviews: (reviewerUserId) => {
    return db.prepare(`
      SELECT a.id, a.title, a.authors, a.abstract, a.type,
        ass.id as assignment_id, e.name as event_name
      FROM assignments ass
      JOIN articles a ON a.id = ass.article_id
      JOIN events e ON e.id = a.event_id
      LEFT JOIN reports rp ON rp.assignment_id = ass.id
      WHERE ass.reviewer_id = ? AND rp.id IS NULL AND ass.status != 'declined'
      ORDER BY a.date_submitted DESC
    `).bind(reviewerUserId).all();
  },
  getReviewedArticles: (reviewerUserId) => {
    return db.prepare(`
      SELECT a.id, a.title, a.authors, a.type,
        ass.id as assignment_id, rp.id as report_id, rp.score, rp.recommendation, rp.report,
        e.name as event_name
      FROM assignments ass
      JOIN articles a ON a.id = ass.article_id
      JOIN events e ON e.id = a.event_id
      JOIN reports rp ON rp.assignment_id = ass.id
      WHERE ass.reviewer_id = ?
      ORDER BY a.date_submitted DESC
    `).bind(reviewerUserId).all();
  },

  getWorkloadSummaryByEvent: (eventId) => {
    return db.prepare(`
      SELECT
        er.id AS registration_id,
        COUNT(aar.id) AS activities_attended,
        COALESCE(SUM(ea.workload_hours), 0) AS total_workload_hours
      FROM event_registrations er
      LEFT JOIN activity_attendance_records aar
        ON aar.registration_id = er.id
        AND aar.activity_id IN (SELECT id FROM event_activities WHERE event_id = ? AND certificate_enabled = 1)
      LEFT JOIN event_activities ea
        ON ea.id = aar.activity_id
      WHERE er.event_id = ?
      GROUP BY er.id
      ORDER BY er.name COLLATE NOCASE
    `).bind(eventId, eventId).all();
  },

  getActivityAttendanceSummary: (activityId, eventId) => {
    return db.prepare(`
      SELECT
        er.id,
        er.name,
        er.email,
        er.institution,
        er.registration_type,
        CASE WHEN aar.id IS NULL THEN 0 ELSE 1 END AS present,
        COALESCE(SUM(ea.workload_hours) FILTER (WHERE aar.id IS NOT NULL), 0) AS workload
      FROM event_registrations er
      LEFT JOIN activity_attendance_records aar
        ON aar.registration_id = er.id
        AND aar.activity_id = ?
      LEFT JOIN event_activities ea
        ON ea.id = ?
      WHERE er.event_id = ?
      GROUP BY er.id
      ORDER BY er.name COLLATE NOCASE
    `).bind(activityId, activityId, eventId).all();
  },

  getActivitiesByEvent: (eventId) => {
    return db.prepare(`
      SELECT ea.*,
        COUNT(DISTINCT aar.user_id) AS attendees_count,
        COALESCE(SUM(ea.workload_hours * 1), 0) AS workload_hours
      FROM event_activities ea
      LEFT JOIN activity_attendance_records aar
        ON aar.activity_id = ea.id
      WHERE ea.event_id = ?
      GROUP BY ea.id
      ORDER BY ea.date_start, ea.name
    `).bind(eventId).all();
  },

  getActivityCertificateRules: (activityId) => {
    return db.prepare(`
      SELECT acr.*, cb.file_path AS background_path, cb.name AS background_name
      FROM activity_certificate_rules acr
      LEFT JOIN certificate_backgrounds cb ON cb.id = acr.background_id
      WHERE acr.activity_id = ?
    `).bind(activityId).get();
  }
};
