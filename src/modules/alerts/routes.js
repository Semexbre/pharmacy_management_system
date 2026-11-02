const router = require('express').Router();
const alerts = require('./service');

router.get('/', (req, res) => {
  const { days, type, q } = req.query;
  res.render('alerts/index', { title: 'Stock alerts', ...alerts.list({ days, type, q }) });
});

module.exports = router;
