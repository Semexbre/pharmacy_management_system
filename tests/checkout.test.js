const test = require('node:test');
const assert = require('node:assert');
const { openDb, closeDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const svc = require('../src/modules/pos/service');
test.after(() => closeDb());

const future = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
};

function setup() {
  closeDb();
  const db = openDb(':memory:');
  migrate(db);
  seed(db);
  db.prepare(`INSERT INTO medicines (name, barcode) VALUES ('Paracetamol', '111')`).run();
  const ins = db.prepare(
    `INSERT INTO inventory_batches
       (medicine_id, batch_number, expiry_date, purchase_cost, selling_price, quantity_received, quantity_on_hand)
     VALUES (1, ?, ?, ?, ?, ?, ?)`
  );
  ins.run('A', future(60), 500, 1000, 5, 5);    // earliest expiry, 5 units @ 10.00
  ins.run('B', future(300), 600, 1200, 10, 10); // later expiry, 10 units @ 12.00
  ins.run('X', future(-5), 100, 900, 50, 50);   // EXPIRED, must never be sold
  return db;
}

const stock = (db) =>
  db.prepare('SELECT batch_number, quantity_on_hand q FROM inventory_batches ORDER BY id').all()
    .map((r) => `${r.batch_number}:${r.q}`).join(',');

test('sale spans batches in FEFO order and skips expired stock', () => {
  const db = setup();
  const r = svc.checkout({ items: [{ medicine_id: 1, quantity: 7 }], payment_method: 'card' }, 1);
  assert.strictEqual(r.total, 5 * 1000 + 2 * 1200);
  assert.strictEqual(stock(db), 'A:0,B:8,X:50');
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM sale_items').pluck().get(), 2);
});

test('oversell is rejected and nothing is written', () => {
  const db = setup();
  assert.throws(() => svc.checkout({ items: [{ medicine_id: 1, quantity: 16 }], payment_method: 'card' }, 1), /Not enough stock/);
  assert.strictEqual(stock(db), 'A:5,B:10,X:50');
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM sales').pluck().get(), 0);
});

test('mid-checkout failure rolls back everything', () => {
  const db = setup();
  // Force a failure AFTER the sale row and first decrements: make sale_items inserts blow up.
  db.exec(`CREATE TRIGGER boom BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
  assert.throws(() => svc.checkout({ items: [{ medicine_id: 1, quantity: 7 }], payment_method: 'card' }, 1), /boom/);
  assert.strictEqual(stock(db), 'A:5,B:10,X:50');
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM sales').pluck().get(), 0);
});

test('cash underpayment and oversized discount are rejected', () => {
  setup();
  assert.throws(() => svc.checkout({ items: [{ medicine_id: 1, quantity: 1 }], payment_method: 'cash', amount_tendered: '5.00' }, 1), /less than the total/);
  assert.throws(() => svc.checkout({ items: [{ medicine_id: 1, quantity: 1 }], payment_method: 'card', discount: '99' }, 1), /Discount/);
});

test('receipt numbers increment per day', () => {
  setup();
  const a = svc.checkout({ items: [{ medicine_id: 1, quantity: 1 }], payment_method: 'card' }, 1);
  const b = svc.checkout({ items: [{ medicine_id: 1, quantity: 1 }], payment_method: 'card' }, 1);
  assert.match(a.receiptNo, /-0001$/);
  assert.match(b.receiptNo, /-0002$/);
});

test('malformed cart lines return validation errors without writes', () => {
  const db = setup();
  for (const items of [[null], [{ medicine_id: 1, quantity: 0 }],
    [{ medicine_id: 1, quantity: 100000 }, { medicine_id: 1, quantity: 1 }]]) {
    assert.throws(() => svc.checkout({ items, payment_method: 'card' }, 1), (err) => err.status === 422);
  }
  assert.strictEqual(db.prepare('SELECT count(*) FROM sales').pluck().get(), 0);
});

test('unsafe monetary totals are rejected without changing stock', () => {
  const db = setup();
  db.prepare('UPDATE inventory_batches SET selling_price = ? WHERE batch_number = ?').run(Number.MAX_SAFE_INTEGER, 'A');
  assert.throws(() => svc.checkout({ items: [{ medicine_id: 1, quantity: 2 }], payment_method: 'card' }, 1), /too large/);
  assert.strictEqual(stock(db), 'A:5,B:10,X:50');
});

test('availability exposes the sellable price tiers in expiry order', () => {
  setup();
  assert.deepStrictEqual(svc.findByBarcode('111').price_tiers, [
    { quantity: 5, unit_price: 1000 }, { quantity: 10, unit_price: 1200 },
  ]);
});
