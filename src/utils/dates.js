// Use the workstation's local calendar date for expiry comparisons.
function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A batch expires after its printed date; flag the next 90 days as near expiry.
function expiryStatus(value, today = todayISO()) {
  if (!isValidIsoDate(value) || !isValidIsoDate(today)) return { key: 'invalid', days: null };
  const days = Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { key: days < 0 ? 'expired' : days <= 90 ? 'soon' : 'ok', days };
}

module.exports = { todayISO, isValidIsoDate, expiryStatus };
