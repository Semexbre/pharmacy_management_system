const express = require('express');
const { getDb } = require('../../db/connection');
const passwords = require('../../security/passwords');
const { HttpError } = require('../../utils/httpError');
const { redirectWithFlash } = require('../../utils/flash');
module.exports = function routes(backups) {
  const router = express.Router();
  router.get('/', (req, res) => res.render('backups/index', { title: 'Backups', files: backups.list(), backupState: backups.state }));
  router.post('/', async (req, res) => {
    await backups.backup();
    redirectWithFlash(res, '/backups', 'Backup created.');
  });
  router.get('/:name/restore', (req, res) => {
    if (!backups.list().some(file => file.name === req.params.name)) throw new HttpError(404, 'Backup not found.');
    res.render('backups/restore', { title: 'Restore backup', filename: req.params.name });
  });
  router.post('/:name/restore', async (req, res) => {
    if (req.body.confirm !== 'RESTORE') throw new HttpError(422, 'Type RESTORE to confirm replacement of the current database.');
    const user = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!passwords.verify(req.body.password, user.password_hash)) throw new HttpError(403, 'Current password is incorrect.');
    await backups.restore(req.params.name, 1);
    await new Promise((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
    res.clearCookie('pms.sid', { path: '/', httpOnly: true, sameSite: 'strict' });
    res.redirect('/login?msg=Backup+restored.+Sign+in+with+credentials+from+that+backup.&type=success');
  });
  router.post('/:name/export', async (req, res) => {
    const copied = await backups.exportBackup(req.params.name);
    redirectWithFlash(res, '/backups', copied ? 'Backup copied to the selected folder.' : 'Copy cancelled.', 'info');
  });
  return router;
};
