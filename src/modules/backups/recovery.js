const fs = require('fs');
const path = require('path');

function writeRestoreMarker(dataDir, state) {
  const filename = path.join(dataDir, 'restore-state.json');
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function recoverRestore(dbPath, dataDir) {
  const marker = path.join(dataDir, 'restore-state.json');
  if (!fs.existsSync(marker)) return false;
  const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const inside = (filename, prefix) => typeof filename === 'string' &&
    path.dirname(path.resolve(filename)) === path.resolve(dataDir) &&
    new RegExp(`^\\.${prefix}-[a-f0-9-]{36}\\.db$`).test(path.basename(filename));
  if (state.database !== dbPath || !inside(state.stage, 'restore') || !inside(state.rollback, 'rollback')) {
    throw new Error('Invalid restore recovery marker. Database was not opened.');
  }
  if (fs.existsSync(state.rollback)) {
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });
    fs.renameSync(state.rollback, dbPath);
  } else if (!fs.existsSync(dbPath)) {
    throw new Error('Restore recovery requires the original database. Database was not opened.');
  }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(state.stage + suffix, { force: true });
  fs.unlinkSync(marker);
  return true;
}
module.exports = { writeRestoreMarker, recoverRestore };
