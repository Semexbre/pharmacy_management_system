const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, closeDb, getDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const { startServer } = require('../src/server');
const { todayISO } = require('../src/utils/dates');
const alerts = require('../src/modules/alerts/service');
const pos = require('../src/modules/pos/service');

test.after(closeDb);
const dateAfter = (today, days) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
function medicine(name, reorder = 10, active = 1) {
  return Number(getDb().prepare('INSERT INTO medicines (name, reorder_level, is_active) VALUES (?, ?, ?)').run(name, reorder, active).lastInsertRowid);
}
function batch(id, code, date, qty) {
  getDb().prepare(`INSERT INTO inventory_batches
    (medicine_id, batch_number, expiry_date, purchase_cost, selling_price, quantity_received, quantity_on_hand)
    VALUES (?, ?, ?, 100, 200, ?, ?)`).run(id, code, date, Math.max(1, qty), qty);
}
function fixtures(today) {
  medicine('No batches', 0);
  const equal = medicine('At threshold', 5);
  batch(equal, 'EQ-A', dateAfter(today, 365), 2);
  batch(equal, 'EQ-B', dateAfter(today, 365), 3);
  const above = medicine('Above threshold', 5);
  batch(above, 'ABOVE', dateAfter(today, 365), 6);
  const empty = medicine('Empty %_ medicine');
  batch(empty, 'EMPTY', today, 0);
  const expired = medicine('Inactive expired', 10, 0);
  batch(expired, 'OLD', dateAfter(today, -1), 20);
  const tiers = medicine('Expiry boundaries', 0);
  for (const days of [0, 30, 31, 60, 61, 90, 91]) batch(tiers, `DAY-${days}`, dateAfter(today, days), 1);
  batch(tiers, 'EMPTY-EXPIRED', dateAfter(today, -1), 0);
}
function setup(today = '2028-02-01') {
  closeDb();
  const db = openDb(':memory:');
  migrate(db);
  seed(db);
  fixtures(today);
  return db;
}

test('low stock includes no batches, zero stock and exact threshold; sums all batches', () => {
  setup();
  const rows = alerts.list({ today: '2028-02-01', type: 'low' }).low;
  assert.deepEqual(rows.map(r => r.name).sort(), ['At threshold', 'Empty %_ medicine', 'No batches']);
  assert.equal(rows.find(r => r.name === 'At threshold').total_stock, 5);
});

test('30/60/90 windows include both boundaries and exclude expired/empty batches', () => {
  setup();
  for (const [days, count] of [[30, 2], [60, 4], [90, 6]]) {
    const opts = { days, today: '2028-02-01' };
    assert.deepEqual(alerts.summary(opts), { low: 3, near: count, expired: 1 });
    const rows = alerts.list(opts);
    assert.equal(rows.near.length, count);
    assert.equal(rows.near.at(-1).days_left, days);
    assert.equal(rows.near[0].days_left, 0);
    assert.equal(rows.expired[0].name, 'Inactive expired');
  }
});

test('alert queries are read-only and search treats wildcard characters literally', () => {
  const db = setup();
  const before = db.prepare('SELECT total_changes()').pluck().get();
  assert.equal(alerts.list({ q: '%_', today: '2028-02-01' }).low.length, 1);
  assert.equal(alerts.list({ q: 'DAY-30', type: 'near', today: '2028-02-01' }).near.length, 1);
  alerts.summary();
  assert.equal(db.prepare('SELECT total_changes()').pluck().get(), before);
  assert.equal(alerts.options({ days: '45', type: 'invalid' }).days, 90);
  assert.equal(alerts.options({ type: 'invalid' }).type, 'all');
});

test('a sale creates a low-stock alert and removes a depleted near-expiry batch', () => {
  const today = todayISO();
  setup(today);
  const id = medicine('Sale threshold', 1);
  batch(id, 'SELL-FIRST', today, 1);
  batch(id, 'SELL-LATER', dateAfter(today, 365), 1);
  const before = alerts.summary();
  pos.checkout({ items: [{ medicine_id: id, quantity: 1 }], payment_method: 'card' }, 1);
  assert.deepEqual(alerts.summary(), { low: before.low + 1, near: before.near - 1, expired: before.expired });
  assert.ok(alerts.list().low.some(row => row.id === id));
  assert.ok(!alerts.list().near.some(row => row.batch_number === 'SELL-FIRST'));
});

test('dashboard, badges and filtered page reflect seeded buckets and a real checkout request', async () => {
  closeDb();
  const server = await startServer({ dbPath: ':memory:' });
  try {
    const today = todayISO();
    fixtures(today);
    const origin = `http://127.0.0.1:${server.port}`;
    const client = require('./helpers/client').client(origin);
    await client.login();
    async function page(path) {
      const response = await client.fetch(origin + path);
      assert.equal(response.status, 200);
      return response.text();
    }
    const dashboard = await page('/?days=30');
    assert.match(dashboard, /data-alert-count="low">3</);
    assert.match(dashboard, /data-alert-count="near">2</);
    assert.match(dashboard, /data-alert-count="expired">1</);
    assert.match(dashboard, /aria-label="2 near-expiry batches"/);
    const expired = await page('/alerts?type=expired&days=30');
    assert.match(expired, /Review for write-off/);
    assert.match(expired, /Inactive expired/);
    assert.doesNotMatch(expired, /id="low-heading"/);
    const filtered = await page('/alerts?type=near&days=30&q=DAY-30');
    assert.match(filtered, /DAY-30/);
    assert.doesNotMatch(filtered, /DAY-31/);
    assert.match(await page('/alerts?q=no-matches'), /No low-stock medicines match/);
    assert.match(await page('/alerts?days=invalid&type=invalid'), /90 days/);
    const id = medicine('HTTP sale', 1);
    batch(id, 'HTTP-FIRST', today, 1);
    batch(id, 'HTTP-LATER', dateAfter(today, 365), 1);
    assert.match(await page('/?days=30'), /data-alert-count="near">3</);
    const response = await client.fetch(origin + '/pos/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ medicine_id: id, quantity: 1 }], payment_method: 'card' }),
    });
    assert.equal(response.status, 200);
    const sale = await response.json();
    const after = await page('/?days=30');
    assert.match(after, /data-alert-count="low">4</);
    assert.match(after, /data-alert-count="near">2</);
    assert.match(await page('/pos/receipt/' + sale.saleId), /aria-label="4 low-stock medicines"/);
  } finally {
    await server.close();
  }
});
