const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { startServer } = require('../src/server');
const { getDb } = require('../src/db/connection');
const { client, ADMIN_PASSWORD } = require('./helpers/client');
const { LocalSessionStore } = require('../src/security/sessionStore');
const { writeRestoreMarker } = require('../src/modules/backups/recovery');

async function memory(fn) {
  const server = await startServer({ dbPath: ':memory:' });
  const origin = `http://127.0.0.1:${server.port}`;
  try { await fn(server, client(origin), origin); } finally { await server.close(); }
}
function temporary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-security-'));
  return { dir, clean() {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(dir).startsWith('pms-security-'));
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

test('login rotates session, hardens cookie, requires password change and validates CSRF', async () => memory(async (_server, admin, origin) => {
  assert.equal((await admin.fetch('/medicines')).headers.get('location'), '/login');
  assert.equal((await admin.fetch('/pos/api/search?q=test')).status, 401);
  const login = await admin.fetch('/login');
  assert.equal(login.headers.get('referrer-policy'), 'same-origin');
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Lax/);
  const anonymousCookie = admin.cookie;
  const missingCsrf = await fetch(origin + '/login', { method: 'POST', headers: { Cookie: admin.cookie }, body: '' });
  assert.equal(missingCsrf.status, 403);
  for (const rejectedOrigin of ['null', 'https://example.com']) {
    const rejected = await admin.fetch('/login', {
      method: 'POST',
      headers: { Origin: rejectedOrigin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'admin', password: 'admin123', _csrf: admin.token }),
    });
    assert.equal(rejected.status, 403, 'Reject untrusted origins even with a valid CSRF token');
  }
  const signedIn = await admin.form('/login', { username: 'admin', password: 'admin123' });
  assert.equal(signedIn.headers.get('location'), '/change-password');
  assert.notEqual(admin.cookie, anonymousCookie);
  assert.equal((await admin.fetch('/pos')).headers.get('location'), '/change-password');
  await admin.fetch('/change-password');
  assert.equal((await admin.form('/change-password', { current_password: 'admin123', password: 'short', confirm: 'short' })).status, 422);
  assert.equal((await admin.form('/change-password', { current_password: 'admin123', password: ADMIN_PASSWORD, confirm: ADMIN_PASSWORD })).status, 302);
  assert.equal(getDb().prepare('SELECT must_change_password FROM users WHERE id=1').pluck().get(), 0);
  await admin.fetch('/users');
  const external = await admin.fetch('/users', { method: 'POST', headers: { Origin: 'https://example.com' }, body: '' });
  assert.equal(external.status, 403);
  const cookie = admin.cookie;
  assert.equal((await admin.form('/logout', {})).status, 302);
  assert.equal((await client(origin, cookie).fetch('/users')).headers.get('location'), '/login');
}));

test('cashier URLs are enforced server-side; reset and deactivation revoke sessions', async () => memory(async (_server, admin, origin) => {
  await admin.login();
  const temp = 'Temporary-Cashier-123';
  assert.equal((await admin.form('/users', { username: 'cashier', full_name: 'Cashier Test', role: 'cashier', password: temp })).status, 302);
  const userId = getDb().prepare("SELECT id FROM users WHERE username='cashier'").pluck().get();
  const cashier = client(origin);
  await cashier.login('cashier', temp, 'Cashier-Secure-123');
  assert.equal((await cashier.fetch('/pos')).status, 200);
  assert.equal((await cashier.fetch('/')).headers.get('location'), '/pos');
  for (const url of ['/medicines', '/medicines/new', '/medicines/1/edit', '/medicines/1/batches/new', '/alerts', '/users', '/backups', '/backups/fake/restore']) {
    assert.equal((await cashier.fetch(url)).status, 403, url);
  }
  for (const url of ['/users', `/users/${userId}/reset`, '/medicines', '/medicines/1/toggle', '/medicines/1/batches', '/backups', '/backups/fake/export', '/backups/fake/restore']) {
    assert.equal((await cashier.form(url, {})).status, 403, url);
  }
  assert.equal((await admin.form('/users/1/deactivate', {})).status, 422);
  assert.equal((await admin.form(`/users/${userId}/reset`, { password: 'Temporary-Reset-123' })).status, 302);
  assert.equal((await cashier.fetch('/pos')).headers.get('location'), '/login');
  await cashier.login('cashier', 'Temporary-Reset-123', 'Cashier-New-Password');
  assert.equal((await admin.form(`/users/${userId}/deactivate`, {})).status, 302);
  assert.equal((await cashier.fetch('/pos')).headers.get('location'), '/login');
  await cashier.fetch('/login');
  assert.equal((await cashier.form('/login', { username: 'cashier', password: 'Cashier-New-Password' })).status, 401);
}));

test('successful sign-ins clear failures and do not accumulate a lockout', async () => memory(async (_server, admin) => {
  await admin.login(); // change the first-run password
  await admin.form('/logout', {});
  await admin.fetch('/login');
  for (let i = 0; i < 9; i++) {
    assert.equal((await admin.form('/login', { username: 'admin', password: 'wrong' })).status, 401);
  }
  for (let i = 0; i < 11; i++) {
    await admin.login('admin', ADMIN_PASSWORD, null);
    assert.equal((await admin.fetch('/')).status, 200);
    assert.equal((await admin.form('/logout', {})).status, 302);
  }
}));

test('login attempts are limited and the limiter survives reopening its local store', async () => memory(async (_server, visitor) => {
  await visitor.fetch('/login');
  for (let i = 0; i < 10; i++) assert.equal((await visitor.form('/login', { username: 'invented-' + i, password: 'wrong' })).status, 401);
  const blocked = await visitor.form('/login', { username: 'admin', password: 'admin123' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const oldNow = Date.now;
  const clockStart = oldNow();
  try {
    Date.now = () => clockStart + 14 * 60000;
    const retry = await visitor.form('/login', { username: 'admin', password: 'admin123' });
    assert.equal(retry.status, 429);
    assert.ok(Number(retry.headers.get('retry-after')) <= 60);
    assert.match(await retry.text(), /Try again in 1 minute\./);
    Date.now = () => clockStart + 15 * 60000;
    const allowed = await visitor.form('/login', { username: 'admin', password: 'admin123' });
    assert.equal(allowed.status, 302, 'Blocked retries must not extend the cooldown');
    assert.equal(allowed.headers.get('location'), '/change-password');
  } finally { Date.now = oldNow; }
  const temp = temporary();
  let store = new LocalSessionStore(path.join(temp.dir, 'sessions.db'));
  try {
    for (let i = 0; i < 10; i++) assert.equal(store.loginAttempt('local', 1000), 0);
    store.close();
    store = new LocalSessionStore(path.join(temp.dir, 'sessions.db'));
    // Use the real clock for the persistence assertion (constructor prunes expired entries).
    for (let i = 0; i < 10; i++) store.loginAttempt('persistent');
    store.close();
    store = new LocalSessionStore(path.join(temp.dir, 'sessions.db'));
    assert.ok(store.loginAttempt('persistent') > 0);
  } finally { store.close(); temp.clean(); }
}));

test('WAL-safe backups open independently; confirmed restore restores state and logs everyone out', async () => {
  const temp = temporary();
  const folder = path.join(temp.dir, 'usb');
  fs.mkdirSync(folder);
  const server = await startServer({ dbPath: path.join(temp.dir, 'pharmacy.db'), chooseBackupFolder: async () => folder });
  const origin = `http://127.0.0.1:${server.port}`;
  const admin = client(origin);
  try {
    assert.equal(server.backups.list().length, 1, 'startup backup');
    await admin.login();
    const peer = client(origin);
    await peer.login('admin', ADMIN_PASSWORD, null);
    getDb().exec("INSERT INTO medicines (name) VALUES ('Earlier state')");
    const name = await server.backups.backup();
    const saved = path.join(temp.dir, 'backups', name);
    const viewer = new Database(saved, { readonly: true, fileMustExist: true });
    assert.equal(viewer.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(viewer.prepare('SELECT name FROM medicines').pluck().get(), 'Earlier state');
    viewer.close();
    getDb().exec("UPDATE medicines SET name='Later state'");
    assert.equal((await admin.fetch(`/backups/${name}/restore`)).status, 200);
    assert.equal((await admin.form(`/backups/${name}/restore`, { confirm: 'NO', password: ADMIN_PASSWORD })).status, 422);
    assert.equal((await admin.form(`/backups/${name}/restore`, { confirm: 'RESTORE', password: 'wrong' })).status, 403);
    assert.equal(getDb().prepare('SELECT name FROM medicines').pluck().get(), 'Later state');
    assert.equal((await admin.form(`/backups/${name}/export`, {})).status, 302);
    assert.deepEqual(fs.readFileSync(path.join(folder, name)), fs.readFileSync(saved));
    const restored = await admin.form(`/backups/${name}/restore`, { confirm: 'RESTORE', password: ADMIN_PASSWORD });
    assert.equal(restored.status, 302, await restored.clone().text());
    assert.equal(getDb().prepare('SELECT name FROM medicines').pluck().get(), 'Earlier state');
    assert.equal((await peer.fetch('/users')).headers.get('location'), '/login');
    assert.equal((await admin.fetch('/users')).headers.get('location'), '/login');
    await admin.login('admin', ADMIN_PASSWORD, null);
    assert.equal((await admin.fetch('/users')).status, 200);
    assert.ok(server.backups.list().length >= 3, 'safety snapshot retained');
  } finally { await server.close(); temp.clean(); }
});

test('retention, scheduled backups, invalid files, restore rollback and session persistence', async () => {
  const temp = temporary();
  const dbPath = path.join(temp.dir, 'pharmacy.db');
  let server = await startServer({ dbPath, backupRetention: 3, backupIntervalMs: 1000 });
  try {
    const deadline = Date.now() + 5000;
    while (server.backups.list().length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(server.backups.list().length >= 2, 'scheduled backup');
    await server.close();
    server = await startServer({ dbPath, backupRetention: 3 });
    for (let i = 0; i < 4; i++) await server.backups.backup();
    assert.equal(server.backups.list().length, 3);
    const admin = client(`http://127.0.0.1:${server.port}`);
    await admin.login();
    const cookie = admin.cookie;
    getDb().exec("INSERT INTO medicines (name) VALUES ('Original')");
    const name = await server.backups.backup();
    getDb().exec("UPDATE medicines SET name='Keep after failure'");
    assert.throws(() => server.backups.restore('../pharmacy.db'), /not found/);
    const invalid = `pharmacy-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.db`;
    fs.writeFileSync(path.join(temp.dir, 'backups', invalid), 'not a SQLite database');
    await assert.rejects(server.backups.restore(invalid));
    assert.equal(getDb().prepare('SELECT name FROM medicines').pluck().get(), 'Keep after failure');
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (path.basename(from).startsWith('.restore-') && to === dbPath) throw new Error('Simulated rename failure');
      return rename(from, to);
    };
    try { await assert.rejects(server.backups.restore(name), /Simulated rename failure/); }
    finally { fs.renameSync = rename; }
    assert.equal(getDb().prepare('SELECT name FROM medicines').pluck().get(), 'Keep after failure');
    await server.close();
    server = await startServer({ dbPath });
    assert.equal((await client(`http://127.0.0.1:${server.port}`, cookie).fetch('/users')).status, 200);
  } finally { await server.close(); temp.clean(); }
});

test('restart recovers an interrupted restore before opening a new database', async () => {
  const temp = temporary();
  const dbPath = path.join(temp.dir, 'pharmacy.db');
  let server = await startServer({ dbPath });
  try {
    getDb().exec("INSERT INTO medicines (name) VALUES ('Survives interruption')");
    const snapshot = await server.backups.backup();
    await server.close();
    server = null;
    const stage = path.join(temp.dir, `.restore-${crypto.randomUUID()}.db`);
    const rollback = path.join(temp.dir, `.rollback-${crypto.randomUUID()}.db`);
    fs.copyFileSync(path.join(temp.dir, 'backups', snapshot), stage);
    writeRestoreMarker(temp.dir, { database: dbPath, stage, rollback });
    fs.renameSync(dbPath, rollback); // simulate exit between moving the old DB and installing the new one
    server = await startServer({ dbPath });
    assert.equal(getDb().prepare('SELECT name FROM medicines').pluck().get(), 'Survives interruption');
    assert.equal(fs.existsSync(path.join(temp.dir, 'restore-state.json')), false);
  } finally { if (server) await server.close(); temp.clean(); }
});

test('sessions expire at their absolute deadline and store idle deadline', async () => memory(async (_server, admin, origin) => {
  await admin.login();
  const oldNow = Date.now;
  try {
    Date.now = () => oldNow() + 8 * 3600000 + 1;
    assert.equal((await client(origin, admin.cookie).fetch('/users')).headers.get('location'), '/login');
  } finally { Date.now = oldNow; }
  const store = new LocalSessionStore(':memory:');
  try {
    store.set('expired', { cookie: { expires: new Date(oldNow() - 1) } });
    store.get('expired', (err, session) => { assert.ifError(err); assert.equal(session, null); });
  } finally { store.close(); }
}));

test('restore blocks new requests while it drains an existing request', async () => {
  const temp = temporary();
  const server = await startServer({ dbPath: path.join(temp.dir, 'pharmacy.db') });
  try {
    const name = await server.backups.backup();
    const { EventEmitter } = require('events');
    const response = new EventEmitter();
    server.backups.middleware({}, response, () => {});
    const restoring = server.backups.restore(name);
    await new Promise(resolve => setImmediate(resolve));
    const blocked = await fetch(`http://127.0.0.1:${server.port}/login`);
    assert.equal(blocked.status, 503);
    response.emit('finish');
    await restoring;
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/login`)).status, 200);
  } finally { await server.close(); temp.clean(); }
});
