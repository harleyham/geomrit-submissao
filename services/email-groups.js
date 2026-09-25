const { db } = require('../db');

const GROUP_EMAIL_REGISTRATION_WHERE = "er.event_id=? AND COALESCE(er.registration_status,'approved')='approved' AND u.is_public=1 AND u.approval_status='approved' AND TRIM(u.email)!=''";

const GROUP_EMAIL_ROLE_LABELS = {
  participant: 'Participante',
  reviewer: 'Revisor',
  speaker: 'Palestrante',
  teacher: 'Professor',
  oral_presenter: 'Apresentador Oral',
  poster_presenter: 'Apresentador Pôster',
  admin: 'Administrador do evento',
  staff: 'Staff'
};

function getGroupEmailRoleLabel(role) {
  return GROUP_EMAIL_ROLE_LABELS[role] || role;
}

function getGroupEmailRecipients(eventId, group, roleId = null, activityId = null) {
  if (group === 'role' && roleId) {
    return db.prepare(`
      SELECT DISTINCT u.id, u.name, u.email
      FROM event_user_roles eur
      JOIN users u ON u.id = eur.user_id
      WHERE eur.event_id = ? AND eur.role = ? AND u.is_public = 1 AND u.approval_status = 'approved' AND TRIM(u.email) != ''
      ORDER BY u.name COLLATE NOCASE
    `).all(eventId, roleId);
  }
  if (group === 'activity' && activityId) {
    return db.prepare(`
      SELECT DISTINCT u.id, u.name, u.email
      FROM participant_activity_enrollments pae
      JOIN event_registrations er ON er.id = pae.registration_id
      JOIN users u ON u.id = pae.user_id
      WHERE pae.activity_id = ? AND ${GROUP_EMAIL_REGISTRATION_WHERE}
      ORDER BY u.name COLLATE NOCASE
    `).all(activityId, eventId);
  }
  return db.prepare(`
    SELECT DISTINCT u.id, u.name, u.email
    FROM event_registrations er
    JOIN users u ON u.id = er.user_id
    WHERE ${GROUP_EMAIL_REGISTRATION_WHERE}
    ORDER BY u.name COLLATE NOCASE
  `).all(eventId);
}

function getGroupEmailOptions(eventId) {
  const roles = db.prepare(`
    SELECT eur.role AS role, COUNT(DISTINCT u.id) AS count
    FROM event_user_roles eur
    JOIN users u ON u.id = eur.user_id
    WHERE eur.event_id = ? AND u.is_public = 1 AND u.approval_status = 'approved' AND TRIM(u.email) != ''
    GROUP BY eur.role
    ORDER BY eur.role
  `).all(eventId);
  const activities = db.prepare(`
    SELECT a.id, a.name, COUNT(DISTINCT pae.user_id) AS count
    FROM participant_activity_enrollments pae
    JOIN event_activities a ON a.id = pae.activity_id
    JOIN event_registrations er ON er.id = pae.registration_id
    JOIN users u ON u.id = pae.user_id
    WHERE a.event_id = ? AND ${GROUP_EMAIL_REGISTRATION_WHERE}
    GROUP BY a.id
    ORDER BY COALESCE(NULLIF(a.name, ''), '') COLLATE NOCASE, a.date_start
  `).all(eventId, eventId);
  return {
    allCount: getGroupEmailRecipients(eventId, 'all').length,
    roles: roles.map((row) => ({ role: row.role, count: row.count, label: getGroupEmailRoleLabel(row.role) })),
    activities
  };
}

module.exports = {
  GROUP_EMAIL_REGISTRATION_WHERE,
  GROUP_EMAIL_ROLE_LABELS,
  getGroupEmailRoleLabel,
  getGroupEmailRecipients,
  getGroupEmailOptions
};
