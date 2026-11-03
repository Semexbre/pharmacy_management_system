const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, closeDb, getDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const { startServer } = require('../src/server');
const { client } = require('./helpers/client');
const dashboard = require('../src/modules/dashboard/service');
const alerts = require('../src/modules/alerts/service');
const now = new Date(2028, 10, 2, 12);
const admin = { id: 1, role: 'admin' };
function setup() {
  closeDb(); const db = openDb(':memory:'); migrate(db); seed(db); return db;
}
test.after(closeDb);
function sale(when, total, status = 'completed', method = 'cash') {
  const db = getDb();
  const id = db.prepare('SELECT COUNT(*) + 1 AS id FROM sales').get().id;
  db.prepare('INSERT INTO sales (id, receipt_no, user_id, subtotal, total, status, payment_method, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)')
    .run(id, `TEST-${id}`, total, total, status, method, when);
  return id;
}
test('ranges use local midnights, equal calendar periods, month and year boundaries, and safe defaults', () => {
  const day = dashboard.rangeOptions({ range: 'today' }, now);
  assert.equal(day.start, new Date(2028, 10, 2).toISOString());
  assert.equal(day.end, new Date(2028, 10, 3).toISOString());
  assert.equal(day.previousStart, new Date(2028, 10, 1).toISOString());
  assert.deepEqual(day.dates, ['2028-11-02']);
  const week = dashboard.rangeOptions({ range: '7' }, new Date(2028, 0, 3, 16));
  assert.equal(week.start, new Date(2027, 11, 28).toISOString());
  assert.equal(week.previousStart, new Date(2027, 11, 21).toISOString());
  assert.equal(week.dates.length, 7);
  const leapMonth = dashboard.rangeOptions({ range: 'month' }, new Date(2028, 1, 29));
  assert.equal(leapMonth.dates.length, 29);
  assert.equal(leapMonth.start, new Date(2028, 1, 1).toISOString());
  assert.equal(leapMonth.previousStart, new Date(2028, 0, 3).toISOString());
  for (const range of ['99999', ['7'], {}, undefined]) assert.equal(dashboard.rangeOptions({ range, days: -1 }, now).range, '30');
  assert.equal(dashboard.rangeOptions({ days: 100000 }, now).days, 90);
});
test('fresh database zero-fills every day and has safe zero-baseline comparisons', () => {
  setup();
  const result = dashboard.summary({ range: '30' }, admin, now);
  assert.equal(result.daily.length, 30);
  assert.ok(result.daily.every(row => row.value === 0));
  assert.equal(result.kpis.revenue.change, null);
  assert.equal(result.business.margin, null);
  assert.equal(result.stock.total, 0);
  assert.deepEqual(result.top, []);
  assert.deepEqual(result.recent, []);
  assert.equal(dashboard.percentChange(100, 0), null);
  assert.equal(dashboard.percentChange(0, 0), null);
  assert.equal(dashboard.percentChange(150, 100), 50);
  assert.equal(dashboard.percentChange(0, 100), -100);
  assert.equal(dashboard.percentChange(0, -100), 100);
});
test('date buckets include start, exclude end and voided sales, and compare the previous period', () => {
  setup(); const range = dashboard.rangeOptions({ range: '7' }, now);
  sale(range.start, 1000);
  sale(new Date(2028, 10, 2, 18).toISOString(), 3000, 'completed', 'mobile');
  sale(new Date(2028, 10, 2, 19).toISOString(), 99999, 'voided');
  sale(range.end, 20000);
  sale(range.previousStart, 2000);
  sale(new Date(Date.parse(range.previousStart) - 1).toISOString(), 50000);
  const result = dashboard.summary({ range: '7' }, admin, now);
  assert.equal(result.kpis.revenue.value, 4000);
  assert.equal(result.kpis.revenue.change, 100);
  assert.equal(result.kpis.transactions.value, 2);
  assert.equal(result.daily[0].value, 1000);
  assert.equal(result.daily.at(-1).value, 3000);
  assert.equal(result.daily.filter(row => row.value === 0).length, 5);
  assert.equal(result.payments.reduce((sum, row) => sum + row.value, 0), 4000);
  assert.equal(result.recent.length, 2);
});
test('multi-batch profit uses snapshot cost, aggregates sales once, and uses shared stock/expiry rules', () => {
  const db = setup();
  db.exec(`INSERT INTO medicines (id, name, reorder_level) VALUES (1, 'Two batches', 2), (2, 'Expired only', 1), (3, 'Zero', 0);
    INSERT INTO inventory_batches (id, medicine_id, batch_number, expiry_date, purchase_cost, selling_price, quantity_received, quantity_on_hand)
    VALUES (1, 1, 'A', '2028-11-02', 9999, 1000, 5, 1), (2, 1, 'B', '2029-01-01', 9999, 1200, 5, 1), (3, 2, 'OLD', '2028-11-01', 100, 200, 20, 20);`);
  const id = sale(new Date(2028, 10, 2, 9).toISOString(), 2000);
  db.prepare('UPDATE sales SET subtotal = 2200, discount = 200 WHERE id = ?').run(id);
  db.prepare('INSERT INTO sale_items (sale_id, batch_id, quantity, unit_price, unit_cost, line_total) VALUES (?, 1, 1, 1000, 300, 1000), (?, 2, 1, 1200, 400, 1200)').run(id, id);
  const voidId = sale(new Date(2028, 10, 2, 10).toISOString(), 1000, 'voided');
  db.prepare('INSERT INTO sale_items (sale_id, batch_id, quantity, unit_price, unit_cost, line_total) VALUES (?, 1, 1, 1000, 300, 1000)').run(voidId);
  const result = dashboard.summary({ range: 'today', days: '30' }, admin, now);
  assert.equal(result.business.cost.value, 700);
  assert.equal(result.business.profit.value, 1300);
  assert.equal(result.business.margin, 65);
  assert.equal(result.top[0].quantity, 2);
  assert.equal(result.top[0].revenue.value, 2200);
  assert.equal(result.business.transactions, 1);
  assert.deepEqual(result.alerts, alerts.summary({ today: '2028-11-02', days: 30 }));
  assert.equal(result.stock.low + result.stock.out, result.alerts.low);
  assert.equal(result.stock.out, 2);
  assert.equal(result.stock.expired, 1);
  assert.equal(result.expiry[0].batch_number, 'OLD');
  assert.equal(result.kpis.inventory.value, 21998);
  assert.equal(result.kpis.inventory.change, null);
});
test('cashier service payload omits cost/profit fields and other cashiers receipt links', () => {
  setup(); sale(new Date(2028, 10, 2, 12).toISOString(), 1000);
  const result = dashboard.summary({ range: 'today' }, { id: 2, role: 'cashier' }, now);
  assert.equal(result.recent[0].receiptUrl, null);
  for (const key of ['profit', 'inventory']) assert.equal(key in result.kpis, false);
  for (const key of ['cost', 'profit', 'margin']) assert.equal(key in result.business, false);
  assert.doesNotMatch(JSON.stringify(result), /unit_cost|purchase_cost|password_hash/);
});
test('dashboard HTTP requires login, redacts cashier JSON and preserves admin URL restrictions', async () => {
  closeDb(); const server = await startServer({ dbPath: ':memory:' });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const visitor = client(origin);
    assert.equal((await visitor.fetch('/dashboard/api/summary')).headers.get('location'), '/login');
    const adminClient = client(origin); await adminClient.login();
    assert.equal((await adminClient.fetch('/dashboard')).status, 200);
    assert.ok((await (await adminClient.fetch('/dashboard/api/summary')).json()).kpis.profit);
    await adminClient.form('/users', { username: 'dashboard-cashier', full_name: 'Dashboard Cashier', role: 'cashier', password: 'Cashier-Temp-123' });
    const cashier = client(origin); await cashier.login('dashboard-cashier', 'Cashier-Temp-123', 'Cashier-New-123');
    const response = await cashier.fetch('/dashboard/api/summary?range=7&days=30&role=admin');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal('profit' in data.kpis, false);
    assert.equal('cost' in data.business, false);
    const page = await (await cashier.fetch('/dashboard')).text();
    assert.doesNotMatch(page, /href="\/(?:users|backups|medicines)|name="q"|Gross profit|Inventory value/);
    assert.equal((await cashier.fetch('/')).headers.get('location'), '/pos');
    for (const url of ['/users', '/backups', '/medicines', '/alerts']) assert.equal((await cashier.fetch(url)).status, 403);
  } finally { await server.close(); }
});
