const { getDb } = require('../db/connection');

function currentUser(req, res, next) {
  req.user = null;
  res.locals.user = null;
  if (req.session.userId) {
    const user = getDb().prepare(`SELECT id, username, full_name, role, is_active,
      must_change_password, session_version FROM users WHERE id = ?`).get(req.session.userId);
    if (user && user.is_active && user.session_version === req.session.version && Date.now() - req.session.authAt < 8 * 3600000) {
      req.user = user;
      res.locals.user = user;
    } else {
      delete req.session.userId;
      delete req.session.version;
    }
  }
  next();
}

module.exports = { currentUser };
