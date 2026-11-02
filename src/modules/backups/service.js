const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { getDb, openDb, closeDb } = require('../../db/connection');
const { migrate } = require('../../db/migrate');
const { HttpError } = require('../../utils/httpError');
const { writeRestoreMarker } = require('./recovery');
const NAME = /^pharmacy-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.db$/;

function createBackups({ dbPath, dataDir, store, chooseFolder, retention = 30, intervalMs = 6 * 3600000 }) {
  const enabled = dbPath !== ':memory:';
  const directory = enabled ? path.join(dataDir, 'backups') : null;
  if (enabled) fs.mkdirSync(directory, { recursive: true });
  let running = null, timer = null, active = 0, stopping = false;
  const state = { restoring: false, lastError: '', intervalMs, retention, enabled, canExport: Boolean(chooseFolder) };
  function list() {
    if (!enabled) return [];
    return fs.readdirSync(directory).filter(name => NAME.test(name)).flatMap(name => {
      const stat = fs.lstatSync(path.join(directory, name));
      return stat.isFile() && !stat.isSymbolicLink() ? [{ name, bytes: stat.size, created: name.slice(9, 33) }] : [];
    }).sort((a, b) => b.name.localeCompare(a.name));
  }
  function resolve(name) {
    if (!enabled || typeof name !== 'string' || !NAME.test(name) || !list().some(file => file.name === name)) throw new HttpError(404, 'Backup not found.');
    return path.join(directory, name);
  }
  function prune() {
    for (const file of list().slice(retention)) fs.unlinkSync(resolve(file.name));
  }
  async function snapshot() {
    const name = `pharmacy-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.db`;
    const destination = path.join(directory, name);
    const partial = destination + '.partial';
    try {
      await getDb().backup(partial);
      fs.renameSync(partial, destination);
      prune();
      state.lastError = '';
      return name;
    } catch (err) {
      fs.rmSync(partial, { force: true });
      throw err;
    }
  }
  function exclusive(task) {
    if (running || stopping) throw new HttpError(409, 'Another backup operation is running. Try again shortly.');
    running = Promise.resolve().then(task).catch(err => { state.lastError = err.message; throw err; }).finally(() => { running = null; });
    return running;
  }
  function backup() {
    if (!enabled) throw new HttpError(400, 'Backups require a file-based database.');
    return exclusive(snapshot);
  }
  function middleware(req, res, next) {
    if (state.restoring || stopping) return res.status(503).set('Retry-After', '5').send('Database maintenance in progress. Please retry shortly.');
    active++;
    let finished = false;
    const release = () => { if (!finished) { finished = true; active--; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  }
  async function drain(allowed) {
    const deadline = Date.now() + 10000;
    while (active > allowed) {
      if (Date.now() > deadline) throw new HttpError(409, 'Other requests are still running. Try restoring again.');
      await new Promise(done => setTimeout(done, 20));
    }
  }
  function inspect(filename, upgrade = false) {
    const db = new Database(filename, { readonly: !upgrade, fileMustExist: true });
    try {
      if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) throw new Error('Database integrity check failed.');
      const version = db.pragma('user_version', { simple: true });
      if (version < 1 || version > getDb().pragma('user_version', { simple: true })) throw new Error('Unsupported backup schema version.');
      const columns = {
        users: 'id, username, full_name, password_hash, role, is_active',
        medicines: 'id, name, generic_name, barcode, dosage_form, strength, description, reorder_level, is_active, created_at, updated_at',
        inventory_batches: 'id, medicine_id, batch_number, expiry_date, purchase_cost, selling_price, quantity_received, quantity_on_hand, received_at, notes',
        sales: 'id, receipt_no, user_id, subtotal, discount, total, amount_tendered, payment_method, status, created_at',
        sale_items: 'id, sale_id, batch_id, quantity, unit_price, unit_cost, line_total',
      };
      for (const [table, fields] of Object.entries(columns)) db.prepare(`SELECT ${fields} FROM ${table} LIMIT 0`).all();
      if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1").get()) throw new Error('Backup has no active administrator.');
      if (upgrade) migrate(db);
      if (upgrade || version >= 2) db.prepare('SELECT must_change_password, session_version FROM users LIMIT 0').all();
    } finally { db.close(); }
  }
  function restore(name, allowedRequests = 0) {
    const source = resolve(name);
    return exclusive(async () => {
      state.restoring = true;
      const stage = path.join(dataDir, `.restore-${crypto.randomUUID()}.db`);
      const rollback = path.join(dataDir, `.rollback-${crypto.randomUUID()}.db`);
      const marker = path.join(dataDir, 'restore-state.json');
      let moved = false;
      try {
        await drain(allowedRequests);
        inspect(source);
        // Stage before making/pruning the safety snapshot, which may remove old backups.
        const input = new Database(source, { readonly: true, fileMustExist: true });
        try { await input.backup(stage); } finally { input.close(); }
        inspect(stage, true);
        const safety = await snapshot();
        const checkpoint = getDb().pragma('wal_checkpoint(TRUNCATE)')[0];
        if (checkpoint.busy) throw new Error('Database is busy; close external database tools and retry.');
        writeRestoreMarker(dataDir, { database: dbPath, stage, rollback });
        closeDb();
        try {
          fs.renameSync(dbPath, rollback);
          moved = true;
          fs.renameSync(stage, dbPath);
          openDb(dbPath);
          store.clear(err => { if (err) throw err; });
          fs.unlinkSync(marker); // commit: restart recovery rolls back until this point
          moved = false;
          try { fs.unlinkSync(rollback); } catch (err) { console.error('[pms] old restore file cleanup:', err.message); }
        } catch (err) {
          closeDb();
          if (moved) {
            fs.rmSync(dbPath, { force: true });
            fs.rmSync(dbPath + '-wal', { force: true });
            fs.rmSync(dbPath + '-shm', { force: true });
            fs.renameSync(rollback, dbPath);
            moved = false;
          }
          openDb(dbPath);
          fs.rmSync(marker, { force: true });
          throw err;
        }
        state.lastError = '';
        return safety;
      } finally {
        try {
          if (!fs.existsSync(marker)) {
            fs.rmSync(stage, { force: true });
            fs.rmSync(stage + '-wal', { force: true });
            fs.rmSync(stage + '-shm', { force: true });
          }
        } finally { state.restoring = fs.existsSync(marker); }
      }
    });
  }
  function exportBackup(name) {
    const source = resolve(name);
    if (!chooseFolder) throw new HttpError(400, 'Copy to a folder is available in the desktop app.');
    return exclusive(async () => {
      const folder = await chooseFolder();
      if (!folder) return false;
      fs.copyFileSync(source, path.join(folder, name), fs.constants.COPYFILE_EXCL);
      return true;
    });
  }
  async function start() {
    if (!enabled) return;
    try { await backup(); } catch (err) { console.error('[pms] startup backup failed:', err.message); }
    timer = setInterval(() => {
      if (!running && !stopping) backup().catch(err => console.error('[pms] scheduled backup failed:', err.message));
    }, intervalMs);
    timer.unref();
  }
  async function stop() { stopping = true; clearInterval(timer); if (running) await running.catch(() => {}); }
  return { list, backup, restore, exportBackup, middleware, state, start, stop };
}
module.exports = { createBackups };
