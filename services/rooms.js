const { db } = require('../db');

const ROOM_SIZES = {
  type1: { label: 'Tipo 1' },
  type2: { label: 'Tipo 2' },
  type3: { label: 'Tipo 3' },
  auditorium: { label: 'Auditório' },
  foyer: { label: 'Foyer' },
  mini_auditorium: { label: 'Mini Auditório' },
  coffee_break: { label: 'Coffee break' },
  restaurant: { label: 'Restaurante' },
  posters: { label: 'Posters' }
};

function normalizeTime(value) {
  const m = String(value || '').trim().match(/^(?:(0?[0-9])|(1[0-9])|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  const hour = String(parseInt(m[1] || m[2], 10)).padStart(2, '0');
  return `${hour}:${m[3]}`;
}

function normalizeDate(value) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : null;
}

function getEventRooms(eventId) {
  return db.prepare('SELECT * FROM event_rooms WHERE event_id=? ORDER BY size,name').all(eventId);
}

function getRoom(eventId, roomId) {
  return db.prepare('SELECT * FROM event_rooms WHERE id=? AND event_id=?').get(roomId, eventId);
}

// Salas do evento livres na data e na faixa de horário informadas. Quando
// excludeActivityId/excludeSessionId é informado, a alocação do próprio alvo é
// ignorada (para manter selecionável a sala já atribuída em uma edição).
function availableRooms({ eventId, date, timeStart, timeEnd, excludeActivityId = null, excludeSessionId = null }) {
  const allRooms = getEventRooms(eventId);
  const isoDate = normalizeDate(date);
  const start = normalizeTime(timeStart);
  const end = normalizeTime(timeEnd);
  if (!isoDate || !start || !end || end <= start) {
    return allRooms.map((room) => ({ id: room.id, name: room.name, size: room.size, capacity: room.capacity, available: true }));
  }
  const busyRows = db.prepare(`
    SELECT ra.room_id AS room_id, ra.activity_id AS activity_id, ra.session_id AS session_id
    FROM room_assignments ra
    JOIN event_rooms r ON r.id = ra.room_id
    WHERE r.event_id = ? AND ra.date = ? AND ra.time_start < ? AND ra.time_end > ?
  `).all(eventId, isoDate, end, start);
  const excludedActivity = excludeActivityId == null ? null : Number(excludeActivityId);
  const excludedSession = excludeSessionId == null ? null : Number(excludeSessionId);
  const busy = new Set();
  busyRows.forEach((row) => {
    if (excludedActivity != null && Number(row.activity_id) === excludedActivity) return;
    if (excludedSession != null && Number(row.session_id) === excludedSession) return;
    busy.add(Number(row.room_id));
  });
  return allRooms.map((room) => ({ id: room.id, name: room.name, size: room.size, capacity: room.capacity, available: !busy.has(Number(room.id)) }));
}

function roomLabel(size) {
  return (ROOM_SIZES[size] && ROOM_SIZES[size].label) || size;
}

function resolveRoomCapacity(_size, capacity) {
  const parsed = Number.parseInt(capacity, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function daysBetween(start, end) {
  const dates = [];
  if (!start || !end) return dates;
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime()) || cursor > last) return dates;
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
    if (dates.length > 366) break;
  }
  return dates;
}

function findConflict({ roomId, date, timeStart, timeEnd, excludeAssignmentId = null }) {
  const rows = db.prepare(`
    SELECT ra.id,ra.date,ra.time_start,ra.time_end,ra.is_event_reservation,ra.activity_id,ra.session_id,
      r.name AS room_name,a.name AS activity_name,s.name AS session_name
    FROM room_assignments ra
    JOIN event_rooms r ON r.id=ra.room_id
    LEFT JOIN event_activities a ON a.id=ra.activity_id
    LEFT JOIN activity_sessions s ON s.id=ra.session_id
    WHERE ra.room_id=? AND ra.date=? AND ra.time_start<? AND ra.time_end>?
      AND (? IS NULL OR ra.id!=?)
    ORDER BY ra.time_start
  `).all(roomId, date, timeEnd, timeStart, excludeAssignmentId, excludeAssignmentId);
  return rows[0] || null;
}

function describeConflict(conflict) {
  if (!conflict) return '';
  const who = conflict.is_event_reservation
    ? 'reserva do evento'
    : conflict.session_id ? `etapa "${conflict.session_name}"` : `atividade "${conflict.activity_name}"`;
  const hm = (t) => (t || '').slice(0, 5);
  return `Sala "${conflict.room_name}" já ocupada nesse horário por ${who} (${hm(conflict.time_start)}–${hm(conflict.time_end)}).`;
}

function assignmentLabel(row) {
  if (row.is_event_reservation) return 'Reserva do evento';
  if (row.session_id) {
    const sessionName = row.session_name || 'Etapa';
    return row.activity_name ? `${row.activity_name}: ${sessionName}` : `Etapa: ${sessionName}`;
  }
  return `Atividade: ${row.activity_name || '-'}`;
}

function replaceTargetAssignments({ roomId, date, timeStart, timeEnd, activityId = null, sessionId = null, eventReservation = false, eventId, assignedBy = null }) {
  const run = db.transaction(() => {
    if (sessionId != null) {
      db.prepare('DELETE FROM room_assignments WHERE session_id=?').run(sessionId);
    } else if (activityId != null) {
      db.prepare('DELETE FROM room_assignments WHERE activity_id=?').run(activityId);
    } else if (eventReservation) {
      db.prepare('DELETE FROM room_assignments WHERE event_id=? AND is_event_reservation=1 AND activity_id IS NULL AND session_id IS NULL').run(eventId);
    }
    if (roomId == null || !date || !timeStart || !timeEnd) return 0;
    const dates = eventReservation ? daysBetween(date.rangeStart, date.rangeEnd) : [date.value];
    let inserted = 0;
    for (const day of dates) {
      const conflict = findConflict({ roomId, date: day, timeStart, timeEnd });
      if (conflict) throw new Error(describeConflict(conflict));
      db.prepare(`
        INSERT INTO room_assignments (event_id,room_id,activity_id,session_id,date,time_start,time_end,is_event_reservation,assigned_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?, ?,?,datetime('now','-3 hours'),datetime('now','-3 hours'))
      `).run(eventId, roomId, activityId, sessionId, day, timeStart, timeEnd, eventReservation ? 1 : 0, assignedBy);
      inserted += 1;
    }
    return inserted;
  });
  return run();
}

function syncTargetAssignments({ eventId, activityId = null, sessionId = null, roomId = null, date, timeStart, timeEnd, assignedBy = null }) {
  if (!roomId) {
    if (sessionId != null) db.prepare('DELETE FROM room_assignments WHERE session_id=?').run(sessionId);
    else if (activityId != null) db.prepare('DELETE FROM room_assignments WHERE activity_id=?').run(activityId);
    return;
  }
  if (!date || !timeStart || !timeEnd) {
    throw new Error('Para alocar sala informe a data e os horários de início e término.');
  }
  replaceTargetAssignments({ roomId, date: { value: date }, timeStart, timeEnd, activityId, sessionId, eventId, assignedBy });
}

function createEventReservation({ eventId, roomId, rangeStart, rangeEnd, timeStart, timeEnd, assignedBy = null }) {
  if (!rangeStart || !rangeEnd || !timeStart || !timeEnd) {
    throw new Error('Informe o intervalo de datas e os horários da reserva.');
  }
  if (rangeStart > rangeEnd) throw new Error('A data final da reserva não pode ser anterior à data inicial.');
  replaceTargetAssignments({ roomId, date: { rangeStart, rangeEnd }, timeStart, timeEnd, eventReservation: true, eventId, assignedBy });
}

function clearEventReservations(eventId) {
  db.prepare('DELETE FROM room_assignments WHERE event_id=? AND is_event_reservation=1 AND activity_id IS NULL AND session_id IS NULL').run(eventId);
}

function roomAssignmentCount(roomId) {
  return db.prepare('SELECT COUNT(*) AS count FROM room_assignments WHERE room_id=?').get(roomId).count;
}

function targetAssignment({ activityId = null, sessionId = null }) {
  const select = db.prepare(`
    SELECT ra.*, r.name AS room_name
    FROM room_assignments ra
    JOIN event_rooms r ON r.id=ra.room_id
    WHERE ${sessionId != null ? 'ra.session_id=?' : 'ra.activity_id=?'}
  `);
  return (sessionId != null ? select.get(sessionId) : select.get(activityId)) || null;
}

function unallocatedTargets(eventId) {
  const sessions = db.prepare(`
    SELECT s.id,s.name,s.session_date,s.time_start,s.time_end,a.id AS activity_id,a.name AS activity_name
    FROM activity_sessions s
    JOIN event_activities a ON a.id=s.activity_id
    WHERE a.event_id=? AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.session_id=s.id)
    ORDER BY (s.session_date IS NULL),s.session_date,s.id
  `).all(eventId);
  const activities = db.prepare(`
    SELECT a.id,a.name,a.date_start,a.date_end,a.time_start,a.time_end
    FROM event_activities a
    WHERE a.event_id=?
      AND NOT EXISTS (SELECT 1 FROM activity_sessions s WHERE s.activity_id=a.id)
      AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.activity_id=a.id)
    ORDER BY (a.date_start IS NULL),a.date_start,a.name
  `).all(eventId);
  return { sessions, activities };
}

function eventReservation(eventId) {
  return db.prepare(`
    SELECT * FROM room_assignments
    WHERE event_id=? AND is_event_reservation=1 AND activity_id IS NULL AND session_id IS NULL
    ORDER BY date LIMIT 1
  `).get(eventId);
}

const ASSIGNMENT_SELECT = `
  SELECT ra.id,ra.date,ra.time_start,ra.time_end,ra.is_event_reservation,ra.activity_id,ra.session_id,
    ra.room_id,r.name AS room_name,r.size AS room_size,r.capacity AS room_capacity,
    a.name AS activity_name,a.id AS activity_event_id,s.name AS session_name
  FROM room_assignments ra
  JOIN event_rooms r ON r.id=ra.room_id
  LEFT JOIN activity_sessions s ON s.id=ra.session_id
  LEFT JOIN event_activities a ON a.id=COALESCE(ra.activity_id, s.activity_id)
  WHERE ra.event_id=?
  ORDER BY ra.date,ra.time_start,r.name
`;

function eventAssignments(eventId) {
  return db.prepare(ASSIGNMENT_SELECT).all(eventId);
}

function occupancyByDay(eventId) {
  const rooms = getEventRooms(eventId);
  const assignments = eventAssignments(eventId);
  const byDay = new Map();
  for (const row of assignments) {
    if (!byDay.has(row.date)) byDay.set(row.date, []);
    byDay.get(row.date).push(row);
  }
  const days = [...byDay.keys()].sort();
  return days.map((date) => ({
    date,
    rooms: rooms.map((room) => ({
      room,
      blocks: byDay.get(date).filter((row) => row.room_id === room.id)
    })),
    unscheduled: byDay.get(date).filter((row) => !rooms.some((room) => room.id === row.room_id))
  }));
}

function agendaByRoom(eventId) {
  const rooms = getEventRooms(eventId);
  const assignments = eventAssignments(eventId);
  return rooms.map((room) => ({
    room,
    assignments: assignments.filter((row) => row.room_id === room.id)
  }));
}

module.exports = {
  ROOM_SIZES, roomLabel, resolveRoomCapacity,
  normalizeTime, normalizeDate, daysBetween,
  getEventRooms, getRoom, availableRooms,
  findConflict, describeConflict, assignmentLabel,
  syncTargetAssignments, createEventReservation, clearEventReservations,
  roomAssignmentCount, targetAssignment, eventReservation, unallocatedTargets,
  eventAssignments, occupancyByDay, agendaByRoom
};
