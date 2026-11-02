const { getDb } = require('../../db/connection');
const { HttpError } = require('../../utils/httpError');
const { parseMoney } = require('../../utils/money');
const { isValidIsoDate, todayISO } = require('../../utils/dates');

const str = (v) => String(v ?? '').trim();

function getBatch(medicineId, batchId) {
  const batch = getDb()
    .prepare('SELECT * FROM inventory_batches WHERE id = ? AND medicine_id = ?')
    .get(batchId, medicineId);
  if (!batch) throw new HttpError(404, 'Batch not found.');
  return batch;
}

/**
 * mode 'create': "quantity" = units received (must be >= 1), expiry must not be in the past.
 * mode 'edit'  : "quantity" = corrected units on hand (>= 0); quantity_received is immutable.
 */
function validate(input = {}, { mode, medicineId, batchId = null }) {
  const errors = {};
  const raw = {
    batch_number: str(input.batch_number),
    expiry_date: str(input.expiry_date),
    purchase_cost: str(input.purchase_cost),
    selling_price: str(input.selling_price),
    quantity: str(input.quantity),
    notes: str(input.notes),
  };

  if (!raw.batch_number) errors.batch_number = 'Batch number is required.';
  else if (raw.batch_number.length > 50) errors.batch_number = 'Max 50 characters.';
  else {
    const dup = getDb()
      .prepare(
        `SELECT 1 FROM inventory_batches
          WHERE medicine_id = ? AND batch_number = ? COLLATE NOCASE AND id IS NOT ?`
      )
      .get(medicineId, raw.batch_number, batchId);
    if (dup) errors.batch_number = 'This medicine already has a batch with that number.';
  }

  if (!isValidIsoDate(raw.expiry_date)) errors.expiry_date = 'Enter a valid date.';
  else if (mode === 'create' && raw.expiry_date < todayISO()) {
    errors.expiry_date = 'This batch is already expired and cannot be received.';
  }

  const cost = parseMoney(raw.purchase_cost);
  if (cost === null) errors.purchase_cost = 'Enter an amount like 12.50.';

  const price = parseMoney(raw.selling_price);
  if (price === null) errors.selling_price = 'Enter an amount like 15.00.';

  const minQty = mode === 'create' ? 1 : 0;
  if (!/^\d{1,9}$/.test(raw.quantity) || parseInt(raw.quantity, 10) < minQty) {
    errors.quantity = mode === 'create' ? 'Enter a whole number of 1 or more.' : 'Enter a whole number (0 or more).';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    raw,
    values: {
      batch_number: raw.batch_number,
      expiry_date: raw.expiry_date,
      purchase_cost: cost,
      selling_price: price,
      quantity: parseInt(raw.quantity, 10),
      notes: raw.notes || null,
    },
  };
}

function createBatch(medicineId, v) {
  const info = getDb()
    .prepare(
      `INSERT INTO inventory_batches
         (medicine_id, batch_number, expiry_date, purchase_cost, selling_price,
          quantity_received, quantity_on_hand, notes)
       VALUES (@medicineId, @batch_number, @expiry_date, @purchase_cost, @selling_price,
               @quantity, @quantity, @notes)`
    )
    .run({ ...v, medicineId });
  return Number(info.lastInsertRowid);
}

/** Price edits affect FUTURE sales only: sale_items snapshot their own price/cost. */
function updateBatch(medicineId, batchId, v) {
  const info = getDb()
    .prepare(
      `UPDATE inventory_batches
          SET batch_number=@batch_number, expiry_date=@expiry_date, purchase_cost=@purchase_cost,
              selling_price=@selling_price, quantity_on_hand=@quantity, notes=@notes
        WHERE id=@batchId AND medicine_id=@medicineId`
    )
    .run({ ...v, batchId, medicineId });
  if (info.changes === 0) throw new HttpError(404, 'Batch not found.');
}

/** A batch that appears on any sale can never be deleted (history/recall traceability). */
function deleteBatch(medicineId, batchId) {
  const db = getDb();
  getBatch(medicineId, batchId);
  const used = db.prepare('SELECT COUNT(*) FROM sale_items WHERE batch_id = ?').pluck().get(batchId);
  if (used > 0) return { ok: false, reason: 'This batch has sales history. Set its quantity to 0 instead.' };
  db.prepare('DELETE FROM inventory_batches WHERE id = ?').run(batchId);
  return { ok: true };
}

module.exports = { getBatch, validate, createBatch, updateBatch, deleteBatch };
