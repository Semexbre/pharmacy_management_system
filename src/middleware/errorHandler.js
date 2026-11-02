function notFound(req, res) {
  res.status(404).render('error', {
    title: 'Not found',
    code: 404,
    message: 'The page you requested does not exist.',
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const code = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
    ? err.status
    : 500;
  if (code >= 500) console.error('[pms] request error:', err);
  if (req.path === '/pos/checkout' || req.path.startsWith('/pos/api/')) {
    return res.status(code).json({ error: err.expose && code < 500 ? err.message : 'Something went wrong.' });
  }
  res.status(code).render('error', {
    title: 'Error',
    code,
    message: err.expose && code < 500 ? err.message : 'Something went wrong. See the application log for details.',
  });
}

module.exports = { notFound, errorHandler };
