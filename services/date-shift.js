// Deslocamento de datas ao mudar a data de início de um evento ou de uma
// atividade (cascade-on-save). As datas são armazenadas como string
// 'YYYY-MM-DD'; o deslocamento usa aritmética de calendário do SQLite
// (date()) para manter o formato e tratar NULL como NULL.
const { db } = require('../db');

const EVENT_WINDOW_COLUMNS = [
  'registration_start', 'registration_end',
  'submission_start', 'submission_end',
  'review_start', 'review_end',
  'certificates_start', 'certificates_end'
];

// Diferença inteira de dias entre duas datas ISO (de, para). 0 quando uma das
// pontas é ausente.
function diffDays(fromIso, toIso) {
  if (!fromIso || !toIso) return 0;
  const ms = Date.parse(`${String(toIso).slice(0, 10)}T12:00:00`) - Date.parse(`${String(fromIso).slice(0, 10)}T12:00:00`);
  return Math.round(ms / 86400000);
}

// Modificador de aritmética de datas do SQLite, sempre com sinal explícito
// ('+N days' / '-N days'); um delta negativo gera '+-N days', inválido.
function modifierFor(days) {
  return `${days >= 0 ? '+' : ''}${days} days`;
}

// Desloca todo o conteúdo agendado de um evento (etapas, atividades e salas).
// Não encosta na tabela de eventos (ela já é escrita pelo handler).
function shiftEventContent(eventId, days) {
  if (!days) return;
  const modifier = modifierFor(days);
  db.prepare(`UPDATE activity_sessions SET session_date = date(session_date, ?) WHERE activity_id IN (SELECT id FROM event_activities WHERE event_id=?)`).run(modifier, eventId);
  db.prepare(`UPDATE event_activities SET activity_date = date(activity_date, ?), date_start = date(date_start, ?), date_end = date(date_end, ?) WHERE event_id=?`).run(modifier, modifier, modifier, eventId);
  db.prepare(`UPDATE room_assignments SET date = date(date, ?) WHERE event_id=?`).run(modifier, eventId);
}

// Desloca as janelas do evento que ainda não foram alteradas pelo usuário
// (comparam com o snapshot salvo antes do save), preservando edições manuais.
function shiftEventWindows(eventId, days, snapshot) {
  if (!days || !snapshot) return;
  const modifier = modifierFor(days);
  for (const col of EVENT_WINDOW_COLUMNS) {
    if (!snapshot[col]) continue;
    db.prepare(`UPDATE events SET ${col} = date(${col}, ?) WHERE id = ? AND ${col} = ?`).run(modifier, eventId, snapshot[col]);
  }
}

// Desloca as datas de TODAS as etapas de uma atividade (mantendo a posição
// relativa de cada uma) e as salas alocadas a essas etapas.
function shiftActivityDates(activityId, days) {
  if (!days) return;
  const modifier = modifierFor(days);
  db.prepare(`UPDATE activity_sessions SET session_date = date(session_date, ?) WHERE activity_id=?`).run(modifier, activityId);
  db.prepare(`UPDATE room_assignments SET date = date(date, ?) WHERE session_id IN (SELECT id FROM activity_sessions WHERE activity_id=?)`).run(modifier, activityId);
}

module.exports = { diffDays, shiftEventContent, shiftEventWindows, shiftActivityDates, EVENT_WINDOW_COLUMNS };
