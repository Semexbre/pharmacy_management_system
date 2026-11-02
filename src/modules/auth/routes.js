const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/connection');
const passwords = require('../../security/passwords');
const { HttpError } = require('../../utils/httpError');
const dummyHash = bcrypt.hashSync('not-a-real-account-password', 10);
const home = (user) => user.role === 'admin' ? '/' : '/pos';
router.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.must_change_password ? '/change-password' : home(req.user));
  res.render('auth/login', { title: 'Sign in', error: '' });
});
router.post('/login', (req, res, next) => {
  const wait = req.sessionStore.loginAttempt(req.ip);
  if (wait) {
    res.set('Retry-After', String(wait));
    return res.status(429).render('auth/login', { title: 'Sign in', error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  }
  const username = typeof req.body.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  const valid = passwords.verify(req.body.password, user?.password_hash || dummyHash);
  if (!valid || !user?.is_active) return res.status(401).render('auth/login', { title: 'Sign in', error: 'Incorrect username or password.' });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.version = user.session_version;
    req.session.authAt = Date.now();
    getDb().prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(user.id);
    req.session.save((err) => err ? next(err) : res.redirect(user.must_change_password ? '/change-password' : home(user)));
  });
});
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('pms.sid', { path: '/', httpOnly: true, sameSite: 'strict' });
    res.redirect('/login');
  });
});
router.get('/change-password', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('auth/password', { title: 'Change password' });
});
router.post('/change-password', (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!passwords.verify(req.body.current_password, user.password_hash)) throw new HttpError(422, 'Current password is incorrect.');
  const password = passwords.validatePassword(req.body.password);
  if (password !== req.body.confirm) throw new HttpError(422, 'Passwords do not match.');
  if (passwords.verify(password, user.password_hash)) throw new HttpError(422, 'Choose a different password.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, session_version = session_version + 1 WHERE id = ?').run(passwords.hash(password), user.id);
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.version = user.session_version + 1;
    req.session.authAt = Date.now();
    req.session.save((err) => err ? next(err) : res.redirect(home(user)));
  });
});
module.exports = router;
