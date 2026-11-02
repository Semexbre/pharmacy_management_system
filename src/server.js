const http = require('http');
const { createApp } = require('./app');
const { openDb, closeDb } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { seed } = require('./db/seed');
const path = require('path');
const { LocalSessionStore, sessionSecret } = require('./security/sessionStore');
const { createBackups } = require('./modules/backups/service');
const { recoverRestore } = require('./modules/backups/recovery');

/**
 * Opens + migrates the DB, then starts HTTP. Resolves once listening.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
async function startServer({ port = 0, host = '127.0.0.1', dbPath, dataDir, chooseBackupFolder,
  backupIntervalMs = 6 * 3600000, backupRetention = 30 } = {}) {
  if (!dbPath) throw new Error('startServer: dbPath is required');
  if (host !== '127.0.0.1') throw new Error('The local server must bind to 127.0.0.1');
  if (!Number.isInteger(backupIntervalMs) || backupIntervalMs < 100 || backupIntervalMs > 2147483647 || !Number.isInteger(backupRetention) || backupRetention < 1) throw new Error('Invalid backup schedule or retention');
  if (dbPath !== ':memory:') dbPath = path.resolve(dbPath);
  dataDir = dbPath === ':memory:' ? null : path.resolve(dataDir || path.dirname(dbPath));

  let app, store, backups;
  try {
    const recovered = dataDir && recoverRestore(dbPath, dataDir);
    const db = openDb(dbPath);
    migrate(db);
    seed(db);
    if (dataDir) require('fs').mkdirSync(dataDir, { recursive: true });
    store = new LocalSessionStore(dataDir ? path.join(dataDir, 'sessions.db') : ':memory:');
    if (recovered) store.clear(err => { if (err) throw err; });
    backups = createBackups({ dbPath, dataDir, store, chooseFolder: chooseBackupFolder, intervalMs: backupIntervalMs, retention: backupRetention });
    await backups.start();
    app = createApp({ store, secret: sessionSecret(dataDir), backups });
  } catch (err) {
    if (backups) await backups.stop();
    if (store) store.close();
    closeDb();
    throw err;
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.once('error', async (err) => {
      await backups.stop();
      store.close();
      closeDb();
      reject(err);
    });

    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        backups,
        close: () =>
          new Promise((done) => {
            server.close(async () => {
              await backups.stop();
              store.close();
              closeDb(); // checkpoints the WAL
              done();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer({
    port: 3000,
    dbPath: process.env.PMS_DB_PATH || path.join(__dirname, '..', 'data', 'pharmacy.db'),
  }).then((server) => {
    console.log(`[pms] dev server on http://127.0.0.1:${server.port}`);
    const shutdown = () => server.close().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((err) => {
    console.error('[pms] server startup failed:', err);
    process.exitCode = 1;
  });
}
