const assert = require('node:assert/strict');
const { startServer } = require('../src/server');
const { getDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const dates = require('../src/utils/dates');
const { parseMoney } = require('../src/utils/money');

async function main() {
  assert.equal(dates.isValidIsoDate('2024-02-29'), true);
  assert.equal(dates.isValidIsoDate('2025-02-29'), false);
  assert.equal(dates.isValidIsoDate('2026-04-31'), false);
  assert.deepEqual(dates.expiryStatus('2026-11-01', '2026-11-01'), { key: 'soon', days: 0 });
  assert.equal(dates.expiryStatus('2026-10-31', '2026-11-01').key, 'expired');
  assert.equal(dates.todayISO(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(parseMoney('1,200.75'), 120075);
  assert.equal(parseMoney('1,2'), null);
  assert.equal(parseMoney('-1'), null);

  const server = await startServer({ dbPath: ':memory:' });
  const origin = `http://127.0.0.1:${server.port}`;
  const client = require('./helpers/client').client(origin);
  await client.login();
  async function request(url, status, data) {
    const res = await client.fetch(origin + url, data === undefined ? {} : {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data),
    });
    const body = await res.text();
    assert.equal(res.status, status, `${url}: ${body.slice(0, 500)}`);
    return { body, location: res.headers.get('location') };
  }
  try {
    migrate(getDb()); // repeat startup must not reapply the schema
    assert.equal(getDb().pragma('user_version', { simple: true }), 2);
    for (const url of ['/', '/health', '/css/app.css', '/js/app.js', '/js/pos.js', '/js/receipt.js', '/pos', '/medicines', '/medicines/new']) {
      await request(url, 200);
    }
    await request('/missing', 404);
    const malformed = await client.fetch(origin + '/medicines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.match(await malformed.text(), /Pharmacy PMS/);
    await request('/medicines/999', 404);
    await request('/medicines', 422, { name: '', reorder_level: '-1' });
    const medicine = { name: 'Test <medicine>', barcode: 'TEST-001', reorder_level: '10' };
    const created = await request('/medicines', 302, medicine);
    const medUrl = created.location.split('?')[0];
    assert.match((await request(medUrl, 200)).body, /Test &lt;medicine&gt;/);
    await request(medUrl + '/edit', 200);
    await request('/medicines', 422, medicine); // duplicate barcode
    await request(medUrl, 302, { ...medicine, name: 'Updated medicine' });
    await request('/medicines?q=Updated', 200);
    await request(medUrl + '/batches/new', 200);
    const batch = { batch_number: 'B-1', expiry_date: '2099-12-31', purchase_cost: '12.50', selling_price: '15', quantity: '20' };
    await request(medUrl + '/batches', 422, { ...batch, expiry_date: '2025-02-29' });
    await request(medUrl + '/batches', 302, batch);
    await request(medUrl + '/batches', 422, batch);
    await request(medUrl, 200);
    await request('/medicines', 200); // renders expiry status for stocked medicine
    const row = getDb().prepare('SELECT * FROM inventory_batches').get();
    assert.equal(row.purchase_cost, 1250);
    const batchUrl = `${medUrl}/batches/${row.id}`;
    await request(batchUrl + '/edit', 200);
    await request(batchUrl, 302, { ...batch, quantity: '15' });
    assert.equal(getDb().prepare('SELECT quantity_on_hand FROM inventory_batches').pluck().get(), 15);
    await request(medUrl + '/toggle', 302, {});
    await request(medUrl + '/batches/new', 400);
    await request(batchUrl, 400, batch);
    await request(batchUrl + '/delete', 400, {});
    await request(medUrl + '/toggle', 302, {});
    await request(batchUrl + '/delete', 302, {});
    assert.equal(getDb().prepare('SELECT count(*) FROM inventory_batches').pluck().get(), 0);
    await request(medUrl + '/batches', 302, batch);
    const lookup = JSON.parse((await request('/pos/api/lookup?barcode=TEST-001', 200)).body);
    assert.equal(lookup.available, 20);
    assert.equal(JSON.parse((await request('/pos/api/search?q=Updated', 200)).body).length, 1);
    const checkout = async (payload, expected) => {
      const response = await client.fetch(origin + '/pos/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      assert.equal(response.status, expected);
      return response.json();
    };
    await checkout({ items: [null] }, 422);
    const badJson = await client.fetch(origin + '/pos/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(badJson.status, 400);
    assert.equal(typeof (await badJson.json()).error, 'string');
    const sold = await checkout({ items: [{ medicine_id: lookup.id, quantity: 2 }], payment_method: 'cash', amount_tendered: '40' }, 200);
    assert.equal(sold.total, 3000);
    assert.equal(getDb().prepare('SELECT quantity_on_hand FROM inventory_batches').pluck().get(), 18);
    const receipt = await request('/pos/receipt/' + sold.saleId, 200);
    assert.ok(receipt.body.includes(sold.receiptNo));
    assert.match(receipt.body, /Administrator/);
    assert.match(receipt.body, /10\.00/);
    await request('/pos/receipt/999', 404);
    console.log('PASS: inventory, POS lookup/search, JSON checkout, stock deduction and receipt rendering');
  } finally {
    await server.close();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
