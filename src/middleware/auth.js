const crypto = require('crypto');
const { HttpError } = require('../utils/httpError');
const isJson = (req) => req.path.startsWith('/pos/api/') || req.path === '/pos/checkout';
function requireAuth(req, res, next) {
  if (!req.user) return isJson(req) ? res.status(401).json({ error: 'Please sign in again.' }) : res.redirect('/login');
  if (req.user.must_change_password) return isJson(req) ? res.status(403).json({ error: 'Change your password before continuing.' }) : res.redirect('/change-password');
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) return next(new HttpError(403, 'You do not have permission to access this page.'));
    next();
  };
}
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const token = req.get('X-CSRF-Token') || req.body?._csrf;
    const expected = req.session.csrf;
    const origin = req.get('Origin');
    if ((origin && origin !== `http://${req.headers.host}`) || typeof token !== 'string' ||
      Buffer.byteLength(token) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return next(new HttpError(403, 'The form expired. Reload the page and try again.'));
    }
  }
  next();
}
module.exports = { requireAuth, requireRole, csrf };
