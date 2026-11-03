const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { formatMoney } = require('./utils/money');
const { expiryStatus, todayISO } = require('./utils/dates');

const medicinesRoutes = require('./modules/medicines/routes');
const inventoryRoutes = require('./modules/inventory/routes');
const { currentUser } = require('./middleware/currentUser');
const posRoutes = require('./modules/pos/routes');
const alerts = require('./modules/alerts/service');
const session = require('express-session');
const { requireAuth, requireRole, csrf } = require('./middleware/auth');

function createApp({ store, secret, backups }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  app.use((req, res, next) => {
    const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!hosts.includes(req.headers.host)) return res.status(403).send('Invalid local host.');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    // Preserve Origin on local form POSTs so CSRF validation can verify them.
    // no-referrer makes Chromium send Origin: null for native form navigation.
    res.set('Referrer-Policy', 'same-origin');
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Locals available to every view
  app.use((req, res, next) => {
    res.locals.title = 'Dashboard';
    res.locals.user = null;
    res.locals.csrfToken = '';
    res.locals.backupError = backups.state.lastError;
    res.locals.currentPath = req.path;
    res.locals.money = formatMoney;
    res.locals.expiryStatus = expiryStatus;
    res.locals.todayISO = todayISO;
    res.locals.alertDays = alerts.options({ days: req.query.days }).days;
    res.locals.alertTiers = alerts.TIERS;
    res.locals.dashboardRange = require('./modules/dashboard/service').rangeOptions(req.query).range;
    let counts;
    Object.defineProperty(res.locals, 'alertCounts', {
      enumerable: true,
      get: () => res.locals.user && !res.locals.user.must_change_password
        ? counts || (counts = alerts.summary({ days: res.locals.alertDays })) : { low: 0, near: 0, expired: 0 },
    });

    const { msg, type } = req.query;
    res.locals.flash = msg
      ? { text: String(msg).slice(0, 200), type: ['success', 'error', 'info'].includes(type) ? type : 'info' }
      : null;
    next();
  });

  // Set view locals before parsers/static middleware so their errors can render.
  app.use(express.static(path.join(__dirname, '..', 'electron', 'public')));
  app.use(backups.middleware);
  app.use(session({
    name: 'pms.sid', store, secret, resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * 60000 },
  }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => { req.body ||= {}; next(); });

  app.use(currentUser);
  app.use(csrf);
  app.use(require('./modules/auth/routes'));
  app.use(requireAuth);
  app.use('/dashboard', require('./modules/dashboard/routes'));
  app.use('/pos', posRoutes);
  app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.get('/', (req, res, next) => req.user.role === 'cashier' ? res.redirect('/pos') : next());
  app.use(requireRole('admin'));
  app.use('/alerts', require('./modules/alerts/routes'));
  app.use('/users', require('./modules/users/routes'));
  app.use('/backups', require('./modules/backups/routes')(backups));

  app.get('/', (req, res) => {
    res.render('dashboard/index', {
      title: 'Dashboard',
    });
  });

  // Order matters: the more specific batch router mounts first.
  app.use('/medicines/:medicineId/batches', inventoryRoutes);
  app.use('/medicines', medicinesRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
