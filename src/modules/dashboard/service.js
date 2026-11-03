const { getDb } = require('../../db/connection');
const alerts = require('../alerts/service');
const { todayISO } = require('../../utils/dates');
const { formatMoney } = require('../../utils/money');

function rangeOptions(input = {}, now = new Date()) {
  const range = ['today', '7', '30', 'month'].includes(input.range) ? input.range : '30';
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'month') start.setDate(1);
  else start.setDate(start.getDate() - (range === '7' ? 6 : range === '30' ? 29 : 0));
  const dates = [];
  for (const day = new Date(start); day < end; day.setDate(day.getDate() + 1)) dates.push(todayISO(day));
  const previous = new Date(start);
  previous.setDate(previous.getDate() - dates.length);
  return { range, days: alerts.options({ days: input.days }).days, today: todayISO(now), dates,
    start: start.toISOString(), end: end.toISOString(), previousStart: previous.toISOString() };
}
function percentChange(value, previous) {
  return previous === 0 ? null : Math.round((value - previous) / Math.abs(previous) * 1000) / 10;
}
const money = value => ({ value, formatted: formatMoney(value) });

function summary(input = {}, user, now = new Date()) {
  const db = getDb();
  const admin = user?.role === 'admin';
  const range = rangeOptions(input, now);
  return db.transaction(() => {
    const period = (start, end) => {
      const totals = db.prepare(`SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS transactions
        FROM sales WHERE status = 'completed' AND created_at >= ? AND created_at < ?`).get(start, end);
      if (admin) {
        totals.cost = db.prepare(`SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) AS cost
          FROM sales s JOIN sale_items i ON i.sale_id = s.id
          WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?`).get(start, end).cost;
        totals.profit = totals.revenue - totals.cost;
      }
      return totals;
    };
    const current = period(range.start, range.end);
    const previous = period(range.previousStart, range.start);
    const counts = alerts.summary({ today: range.today, days: range.days });
    const stock = alerts.stockSummary({ today: range.today });
    const expiry = alerts.list({ today: range.today, days: range.days });
    const dailyRows = db.prepare(`SELECT date(created_at, 'localtime') AS day, SUM(total) AS total
      FROM sales WHERE status = 'completed' AND created_at >= ? AND created_at < ?
      GROUP BY date(created_at, 'localtime')`).all(range.start, range.end);
    const dailyMap = new Map(dailyRows.map(row => [row.day, row.total]));
    const kpis = {
      revenue: { ...money(current.revenue), change: percentChange(current.revenue, previous.revenue) },
      transactions: { value: current.transactions, change: percentChange(current.transactions, previous.transactions) },
      lowStock: { value: counts.low, change: null, note: 'Current stock; historical snapshots unavailable' },
    };
    const business = { revenue: money(current.revenue), transactions: current.transactions };
    if (admin) {
      kpis.profit = { ...money(current.profit), change: percentChange(current.profit, previous.profit) };
      kpis.inventory = { ...money(db.prepare('SELECT COALESCE(SUM(quantity_on_hand * purchase_cost), 0) AS value FROM inventory_batches').get().value),
        change: null, note: 'Current on-hand cost, including expired stock; historical snapshots unavailable' };
      business.cost = money(current.cost);
      business.profit = money(current.profit);
      business.margin = current.revenue === 0 ? null : Math.round(current.profit / current.revenue * 1000) / 10;
    }
    const top = db.prepare(`SELECT m.id, m.name, SUM(i.quantity) AS quantity, SUM(i.line_total) AS revenue
      FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN inventory_batches b ON b.id = i.batch_id
      JOIN medicines m ON m.id = b.medicine_id
      WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
      GROUP BY m.id ORDER BY quantity DESC, revenue DESC, m.id LIMIT 5`).all(range.start, range.end)
      .map(row => ({ ...row, revenue: money(row.revenue) }));
    const payments = db.prepare(`SELECT payment_method, SUM(total) AS total FROM sales
      WHERE status = 'completed' AND created_at >= ? AND created_at < ? GROUP BY payment_method`).all(range.start, range.end);
    const recent = db.prepare(`SELECT s.id, s.receipt_no, s.user_id, s.total, s.created_at, u.full_name AS cashier
      FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status = 'completed'
      AND s.created_at >= ? AND s.created_at < ? ORDER BY s.created_at DESC, s.id DESC LIMIT 8`).all(range.start, range.end)
      .map(row => ({ id: row.id, receipt: row.receipt_no, cashier: row.cashier, total: money(row.total), createdAt: row.created_at,
        receiptUrl: admin || row.user_id === user?.id ? `/pos/receipt/${row.id}` : null }));
    return { range, kpis, business, alerts: counts, stock: { ...stock, expired: counts.expired },
      daily: range.dates.map(day => ({ day, ...money(dailyMap.get(day) || 0) })), top,
      expiry: [...expiry.expired, ...expiry.near].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.id - b.id).slice(0, 5),
      payments: ['cash', 'card', 'mobile', 'other'].map(method => ({ method, ...money(payments.find(row => row.payment_method === method)?.total || 0) })),
      recent };
  })();
}
module.exports = { rangeOptions, percentChange, summary };
