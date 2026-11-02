const router = require('express').Router();
const { getDb } = require('../../db/connection');
const passwords = require('../../security/passwords');
const { HttpError } = require('../../utils/httpError');
const { redirectWithFlash } = require('../../utils/flash');
router.get('/', (req, res) => res.render('users/index', {
  title: 'Users', users: getDb().prepare('SELECT id, username, full_name, role, is_active, must_change_password FROM users ORDER BY username').all(),
}));
router.post('/', (req, res) => {
  const username = String(req.body.username || '').trim();
  const name = String(req.body.full_name || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || !name || name.length > 100 || !['admin', 'cashier'].includes(req.body.role)) throw new HttpError(422, 'Enter a valid username, full name, and role.');
  const hash = passwords.hash(req.body.password);
  if (getDb().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(422, 'Username already exists.');
  getDb().prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, name, hash, req.body.role);
  redirectWithFlash(res, '/users', 'User created. They must change their temporary password at sign-in.');
});
router.post('/:id/deactivate', (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const user = Number.isSafeInteger(id) ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  if (!user) throw new HttpError(404, 'User not found.');
  if (id === req.user.id) throw new HttpError(422, 'You cannot deactivate your own account.');
  if (user.role === 'admin' && user.is_active && db.prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1").pluck().get() <= 1) throw new HttpError(422, 'Keep at least one active administrator.');
  db.prepare('UPDATE users SET is_active = 0, session_version = session_version + 1 WHERE id = ?').run(id);
  redirectWithFlash(res, '/users', 'User deactivated and existing sessions revoked.');
});
router.post('/:id/reset', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(422, 'Use Change password for your own account.');
  if (!Number.isSafeInteger(id) || !getDb().prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'User not found.');
  getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 1, session_version = session_version + 1 WHERE id = ?').run(passwords.hash(req.body.password), id);
  redirectWithFlash(res, '/users', 'Temporary password set. Existing sessions were revoked.');
});
module.exports = router;
