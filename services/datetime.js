// Helpers de data no fuso America/Sao_Paulo (UTC-3), centralizadas para que as
// janelas do cronograma pública e os status de etapa usem "hoje no Brasil" de
// forma consistente, independentemente do fuso em que o host está configurado.
function brDate(value, time = '00:00:00') {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T${time}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function brToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-03:00`);
}

module.exports = { brDate, brToday };
