const { getDb } = require('../../db/connection');
const { HttpError } = require('../../utils/httpError');
const { parseMoney } = require('../../utils/money');
const { todayISO } = require('../../utils/dates');

const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'other'];
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

/** Batches that can be sold right now: in stock and not expired, earliest expiry first (FEFO). */
function sellableBatches(medicineId, today = todayISO()) {
  return getDb()
    .prepare(
      `SELECT id, batch_number, selling_price, purchase_cost, quantity_on_hand
         FROM inventory_batches
        WHERE medicine_id = ? AND quantity_on_hand > 0 AND expiry_date >= ?
        ORDER BY expiry_date, id`
    )
    .all(medicineId, today);
}

function withAvailability(med) {
  const batches = sellableBatches(med.id);
  return {
    id: med.id,
    name: med.name,
    generic_name: med.generic_name,
    strength: med.strength,
    dosage_form: med.dosage_form,
    barcode: med.barcode,
    available: batches.reduce((s, b) => s + b.quantity_on_hand, 0),
    unit_price: batches.length ? batches[0].selling_price : null, // price of the next batch to be sold
    price_varies: new Set(batches.map((b) => b.selling_price)).size > 1,
    price_tiers: batches.map((b) => ({ quantity: b.quantity_on_hand, unit_price: b.selling_price })),
  };
}

function findByBarcode(code) {
  const med = getDb()
    .prepare('SELECT * FROM medicines WHERE barcode = ? AND is_active = 1')
    .get(code);
  return med ? withAvailability(med) : null;
}

function search(q) {
  const like = `%${escapeLike(q)}%`;
  const rows = getDb()
    .prepare(
      `SELECT * FROM medicines
        WHERE is_active = 1
          AND (name LIKE ? ESCAPE '\\' OR generic_name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')
        ORDER BY name COLLATE NOCASE
        LIMIT 8`
    )
    .all(like, like, like);
  return rows.map(withAvailability);
}

/**
 * Atomic checkout. The client sends ONLY medicine ids + quantities (+ payment info);
 * every price and cost is read from the DB here. Any throw rolls everything back.
 */
function checkout(input, userId) {
  const db = getDb();
  if (!input || typeof input !== 'object') throw new HttpError(422, 'Invalid checkout request.');

  // ---- 1. Normalise and validate input (no DB writes yet) ----
  const wanted = new Map(); // medicine_id -> total quantity (duplicates merged)
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length > 200) throw new HttpError(422, 'Too many cart lines.');
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') throw new HttpError(422, 'Invalid cart item.');
    const id = Number(it.medicine_id);
    const qty = Number(it.quantity);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 100000) {
      throw new HttpError(422, 'Invalid cart item.');
    }
    const combined = (wanted.get(id) || 0) + qty;
    if (combined > 100000) throw new HttpError(422, 'Too many units of one medicine.');
    wanted.set(id, combined);
  }
  if (wanted.size === 0) throw new HttpError(422, 'The cart is empty.');

  const method = String(input.payment_method || 'cash');
  if (!PAYMENT_METHODS.includes(method)) throw new HttpError(422, 'Invalid payment method.');

  const discountRaw = String(input.discount ?? '').trim();
  const discount = discountRaw === '' ? 0 : parseMoney(discountRaw);
  if (discount === null) throw new HttpError(422, 'Invalid discount amount.');

  const tenderedRaw = String(input.amount_tendered ?? '').trim();
  const tenderedInput = tenderedRaw === '' ? null : parseMoney(tenderedRaw);
  if (tenderedRaw !== '' && tenderedInput === null) throw new HttpError(422, 'Invalid amount tendered.');

  // ---- 2. Everything below runs in ONE transaction ----
  const getMed = db.prepare('SELECT id, name, is_active FROM medicines WHERE id = ?');
  const decrement = db.prepare(
    `UPDATE inventory_batches
        SET quantity_on_hand = quantity_on_hand - @qty
      WHERE id = @id AND quantity_on_hand >= @qty`
  );
  const insertSale = db.prepare(
    `INSERT INTO sales (receipt_no, user_id, subtotal, discount, total, amount_tendered, payment_method)
     VALUES (@receipt_no, @user_id, @subtotal, @discount, @total, @amount_tendered, @payment_method)`
  );
  const insertItem = db.prepare(
    `INSERT INTO sale_items (sale_id, batch_id, quantity, unit_price, unit_cost, line_total)
     VALUES (@sale_id, @batch_id, @quantity, @unit_price, @unit_cost, @line_total)`
  );
  const lastSeq = db.prepare(
    `SELECT MAX(CAST(SUBSTR(receipt_no, ?) AS INTEGER)) FROM sales WHERE receipt_no LIKE ?`
  );

  const run = db.transaction(() => {
    const today = todayISO();

    // 2a. FEFO allocation (in memory), re-reading stock inside the transaction
    const lines = [];
    let subtotal = 0;
    for (const [medicineId, qtyNeeded] of wanted) {
      const med = getMed.get(medicineId);
      if (!med || !med.is_active) throw new HttpError(422, 'A medicine in the cart is no longer available.');

      const batches = sellableBatches(medicineId, today);
      const available = batches.reduce((s, b) => s + b.quantity_on_hand, 0);
      if (available < qtyNeeded) {
        throw new HttpError(
          422,
          `Not enough stock for "${med.name}": requested ${qtyNeeded}, only ${available} sellable (expired batches are excluded).`
        );
      }

      let remaining = qtyNeeded;
      for (const b of batches) {
        if (remaining === 0) break;
        const take = Math.min(remaining, b.quantity_on_hand);
        const lineTotal = take * b.selling_price;
        if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
          throw new HttpError(422, 'Sale amount is too large.');
        }
        lines.push({ batch_id: b.id, quantity: take, unit_price: b.selling_price, unit_cost: b.purchase_cost, line_total: lineTotal });
        subtotal += lineTotal;
        remaining -= take;
      }
    }

    // 2b. Totals and payment rules
    if (discount > subtotal) throw new HttpError(422, 'Discount cannot exceed the subtotal.');
    const total = subtotal - discount;

    let amountTendered;
    if (method === 'cash') {
      if (tenderedInput === null || tenderedInput < total) {
        throw new HttpError(422, 'Cash tendered is less than the total.');
      }
      amountTendered = tenderedInput;
    } else {
      amountTendered = total; // card / mobile / other: exact payment
    }

    // 2c. Receipt number: R-YYYYMMDD-NNNN (daily sequence)
    const prefix = `R-${today.replace(/-/g, '')}-`;
    const seq = (lastSeq.pluck().get(prefix.length + 1, `${prefix}%`) || 0) + 1;
    const receiptNo = prefix + String(seq).padStart(4, '0');

    // 2d. Writes
    const saleId = Number(
      insertSale.run({
        receipt_no: receiptNo, user_id: userId, subtotal, discount, total,
        amount_tendered: amountTendered, payment_method: method,
      }).lastInsertRowid
    );

    for (const line of lines) {
      // Guarded decrement: if it didn't touch exactly 1 row, stock changed under us -> roll back.
      const res = decrement.run({ id: line.batch_id, qty: line.quantity });
      if (res.changes !== 1) throw new HttpError(409, 'Stock changed during checkout. Please try again.');
      insertItem.run({ sale_id: saleId, ...line });
    }

    return { saleId, receiptNo, total };
  });

  return run.immediate(); // takes the write lock up front
}

function getReceipt(saleId) {
  const db = getDb();
  const sale = db
    .prepare(
      `SELECT s.*, u.full_name AS cashier
         FROM sales s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .get(saleId);
  if (!sale) throw new HttpError(404, 'Receipt not found.');

  const items = db
    .prepare(
      `SELECT si.quantity, si.unit_price, si.line_total, b.batch_number, m.name, m.strength
         FROM sale_items si
         JOIN inventory_batches b ON b.id = si.batch_id
         JOIN medicines m ON m.id = b.medicine_id
        WHERE si.sale_id = ?
        ORDER BY si.id`
    )
    .all(saleId);

  return { sale, items };
}

module.exports = { findByBarcode, search, checkout, getReceipt };
