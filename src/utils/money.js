// Money is stored as INTEGER minor units (12.50 -> 1250). Never use floats for storage.

/** "12.5" | "1,200.75" -> 1250 | 120075. Returns null if invalid. */
function parseMoney(input) {
  const raw = String(input ?? '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const s = raw.replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, '0'), 10);
}

/** 120075 -> "1,200.75" (add a currency symbol here or in views if you want one) */
function formatMoney(minor) {
  return (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 120075 -> "1200.75" (for prefilling <input> values) */
function toInputValue(minor) {
  return (minor / 100).toFixed(2);
}

module.exports = { parseMoney, formatMoney, toInputValue };
