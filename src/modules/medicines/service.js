const { getDb } = require('../../db/connection');
const { HttpError } = require('../../utils/httpError');

const PAGE_SIZE = 25;
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

const str = (v) => String(v ?? '').trim();
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

function list({ q = '', status = 'active', page = 1 }) {
  const db = getDb();
  const where = [];
  const params = [];

  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      `(m.name LIKE ? ESCAPE '\\' OR m.generic_name LIKE ? ESCAPE '\\' OR m.barcode LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like);
  }
  if (status === 'active') where.push('m.is_active = 1');
  if (status === 'inactive') where.push('m.is_active = 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) FROM medicines m ${whereSql}`).pluck().get(...params);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);

  const rows = db
    .prepare(
      `SELECT m.*,
              COALESCE(SUM(b.quantity_on_hand), 0) AS total_stock,
              COALESCE(SUM(CASE WHEN b.quantity_on_hand > 0 THEN 1 ELSE 0 END), 0) AS active_batches,
              MIN(CASE WHEN b.quantity_on_hand > 0 THEN b.expiry_date END) AS nearest_expiry
         FROM medicines m
         LEFT JOIN inventory_batches b ON b.medicine_id = m.id
         ${whereSql}
        GROUP BY m.id
        ORDER BY m.name COLLATE NOCASE
        LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, (current - 1) * PAGE_SIZE);

  return { rows, total, page: current, pages };
}

/** Medicine row (without batches). Throws 404 if missing. */
function getById(id) {
  const med = getDb().prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!med) throw new HttpError(404, 'Medicine not found.');
  return med;
}

function getWithBatches(id) {
  const medicine = getById(id);
  const batches = getDb()
    .prepare('SELECT * FROM inventory_batches WHERE medicine_id = ? ORDER BY expiry_date, id')
    .all(id);
  const totalStock = batches.reduce((sum, b) => sum + b.quantity_on_hand, 0);
  return { medicine, batches, totalStock };
}

function validate(input = {}, { id = null } = {}) {
  const errors = {};
  const raw = {
    name: str(input.name),
    generic_name: str(input.generic_name),
    barcode: str(input.barcode),
    dosage_form: str(input.dosage_form),
    strength: str(input.strength),
    description: str(input.description),
    reorder_level: str(input.reorder_level),
  };

  if (!raw.name) errors.name = 'Name is required.';
  else if (raw.name.length > 150) errors.name = 'Name is too long (max 150).';

  if (raw.barcode) {
    if (raw.barcode.length > 64 || /\s/.test(raw.barcode)) {
      errors.barcode = 'Barcode must be 64 characters or fewer, with no spaces.';
    } else {
      const clash = getDb()
        .prepare('SELECT name FROM medicines WHERE barcode = ? AND id IS NOT ?')
        .get(raw.barcode, id);
      if (clash) errors.barcode = `Barcode already used by "${clash.name}".`;
    }
  }

  if (!/^\d{1,7}$/.test(raw.reorder_level)) {
    errors.reorder_level = 'Enter a whole number (0 or more).';
  }

  const values = {
    name: raw.name,
    generic_name: raw.generic_name || null,
    barcode: raw.barcode || null, // empty -> NULL so the UNIQUE constraint allows many blanks
    dosage_form: raw.dosage_form || null,
    strength: raw.strength || null,
    description: raw.description || null,
    reorder_level: parseInt(raw.reorder_level, 10),
  };

  return { ok: Object.keys(errors).length === 0, errors, raw, values };
}

function create(v) {
  const info = getDb()
    .prepare(
      `INSERT INTO medicines (name, generic_name, barcode, dosage_form, strength, description, reorder_level)
       VALUES (@name, @generic_name, @barcode, @dosage_form, @strength, @description, @reorder_level)`
    )
    .run(v);
  return Number(info.lastInsertRowid);
}

function update(id, v) {
  const info = getDb()
    .prepare(
      `UPDATE medicines
          SET name=@name, generic_name=@generic_name, barcode=@barcode, dosage_form=@dosage_form,
              strength=@strength, description=@description, reorder_level=@reorder_level,
              updated_at=${NOW}
        WHERE id=@id`
    )
    .run({ ...v, id });
  if (info.changes === 0) throw new HttpError(404, 'Medicine not found.');
}

function setActive(id, active) {
  const info = getDb()
    .prepare(`UPDATE medicines SET is_active = ?, updated_at = ${NOW} WHERE id = ?`)
    .run(active ? 1 : 0, id);
  if (info.changes === 0) throw new HttpError(404, 'Medicine not found.');
}

module.exports = { list, getById, getWithBatches, validate, create, update, setActive };
