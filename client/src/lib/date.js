// Brief timestamps come from SQLite's datetime('now'), which is UTC but stored
// as a bare "YYYY-MM-DD HH:MM:SS" string with no timezone marker. new Date()
// would misparse that as *local* time, so we normalize it to UTC first and then
// always render in US Eastern time (EST/EDT).

const TZ = 'America/New_York';

function toUTCDate(dateStr) {
  if (!dateStr) return null;
  // Bare SQLite datetime ("YYYY-MM-DD HH:MM:SS") → explicit UTC ISO.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)
    ? dateStr.replace(' ', 'T') + 'Z'
    : dateStr;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

// Full header line, e.g. "Friday, May 29, 2026 at 9:25 PM EDT"
export function formatBriefDateTime(dateStr) {
  const d = toUTCDate(dateStr);
  if (!d) return '';
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: TZ, timeZoneName: 'short',
  });
}

// Sidebar date, e.g. "May 28, 2026"
export function formatShortDate(dateStr) {
  const d = toUTCDate(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ,
  });
}

// Sidebar time, e.g. "9:25 PM EDT"
export function formatShortTime(dateStr) {
  const d = toUTCDate(dateStr);
  if (!d) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: TZ, timeZoneName: 'short',
  });
}
