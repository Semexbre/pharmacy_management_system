const express = require('express');
const svc = require('./service');
const { HttpError } = require('../../utils/httpError');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pos/index', { title: 'Point of sale' });
});

// ---- JSON helpers for the POS screen --------------------------------
router.get('/api/lookup', (req, res) => {
  const code = String(req.query.barcode ?? '').trim();
  if (!code) return res.status(400).json({ error: 'Barcode required.' });
  const med = svc.findByBarcode(code);
  if (!med) return res.status(404).json({ error: 'No active medicine with that barcode.' });
  res.json(med);
});

router.get('/api/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  res.json(q.length < 2 ? [] : svc.search(q));
});

// ---- Checkout ------------------------------------------------------------
router.post('/checkout', (req, res, next) => {
  try {
    res.json(svc.checkout(req.body || {}, req.user.id));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ---- Printable receipt -----------------------------------------------------
router.get('/receipt/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Receipt not found.');
  const { sale, items } = svc.getReceipt(id);
  if (req.user.role !== 'admin' && sale.user_id !== req.user.id) throw new HttpError(403, 'You may only view your own receipts.');
  res.render('pos/receipt', {
    title: sale.receipt_no,
    sale,
    items,
    when: new Date(sale.created_at).toLocaleString(),
    change: sale.amount_tendered - sale.total,
  });
});

module.exports = router;
