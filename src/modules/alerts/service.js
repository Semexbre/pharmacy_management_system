const { getDb } = require('../../db/connection');
const { todayISO, isValidIsoDate } = require('../../utils/dates');

const TIERS = [30, 60, 90];
const TYPES = ['all', 'low', 'near', 'expired'];
const STOCK = `SELECT m.id, m.name, m.is_active, m.reorder_level,
    COALESCE(SUM(b.quantity_on_hand), 0) AS total_stock
  FROM medicines m
  LEFT JOIN inventory_batches b ON b.medicine_id = m.id AND b.quantity_on_hand > 0 AND b.expiry_date >= @today
  GROUP BY m.id`;
const LOW = `${STOCK} HAVING total_stock <= m.reorder_level`;

function stockSummary(input = {}) {
  const { today } = options(input);
  return getDb().prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(total_stock = 0), 0) AS out,
    COALESCE(SUM(total_stock > 0 AND total_stock <= reorder_level), 0) AS low,
    COALESCE(SUM(total_stock > reorder_level), 0) AS inStock
    FROM (${STOCK})`).get({ today });
}

function options(input = {}) {
  const days = TIERS.includes(Number(input.days)) ? Number(input.days) : 90;
  const today = input.today === undefined ? todayISO() : input.today;
  if (!isValidIsoDate(today)) throw new TypeError('Invalid alert date');
  return {
    days, today,
    type: TYPES.includes(input.type) ? input.type : 'all',
    q: typeof input.q === 'string' ? input.q.trim().slice(0, 150) : '',
  };
}

// One read statement gives a consistent summary. Counts are medicines for low
// stock and batches for expiry, so they must not be presented as unique items.
function summary(input = {}) {
  const { days, today } = options(input);
  return getDb().prepare(`SELECT
    (SELECT COUNT(*) FROM (${LOW})) AS low,
    (SELECT COUNT(*) FROM inventory_batches WHERE quantity_on_hand > 0
      AND expiry_date >= @today AND expiry_date <= date(@today, '+' || @days || ' days')) AS near,
    (SELECT COUNT(*) FROM inventory_batches WHERE quantity_on_hand > 0
      AND expiry_date < @today) AS expired`).get({ today, days });
}

function list(input = {}) {
  const filters = options(input);
  const { days, today, q, type } = filters;
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const low = type === 'all' || type === 'low'
    ? getDb().prepare(`SELECT * FROM (${LOW}) WHERE name LIKE @like ESCAPE '\\'
        ORDER BY total_stock, name COLLATE NOCASE, id`).all({ today, like })
    : [];
  function batches(expired) {
    const condition = expired ? 'b.expiry_date < @today'
      : "b.expiry_date >= @today AND b.expiry_date <= date(@today, '+' || @days || ' days')";
    const params = { today, like };
    if (!expired) params.days = days;
    return getDb().prepare(`SELECT b.id, b.medicine_id, b.batch_number, b.expiry_date,
        b.quantity_on_hand, m.name, m.is_active,
        CAST(julianday(b.expiry_date) - julianday(@today) AS INTEGER) AS days_left
      FROM inventory_batches b JOIN medicines m ON m.id = b.medicine_id
      WHERE b.quantity_on_hand > 0 AND ${condition}
        AND (m.name LIKE @like ESCAPE '\\' OR b.batch_number LIKE @like ESCAPE '\\')
      ORDER BY b.expiry_date, m.name COLLATE NOCASE, b.id`).all(params);
  }
  return {
    filters, low,
    near: type === 'all' || type === 'near' ? batches(false) : [],
    expired: type === 'all' || type === 'expired' ? batches(true) : [],
  };
}

module.exports = { TIERS, options, summary, list, stockSummary };
