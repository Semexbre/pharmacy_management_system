const router = require('express').Router();
const service = require('./service');
router.get('/api/summary', (req, res) => res.json(service.summary(req.query, req.user)));
router.get('/', (req, res) => res.render('dashboard/index', { title: 'Dashboard' }));
module.exports = router;
