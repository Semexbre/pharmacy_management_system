const express = require('express');
const svc = require('./service');
const medicines = require('../medicines/service');
const { toInputValue } = require('../../utils/money');
const { redirectWithFlash } = require('../../utils/flash');
const { HttpError } = require('../../utils/httpError');

// mergeParams exposes :medicineId from the mount path in app.js
const router = express.Router({ mergeParams: true });

const parseId = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, `${what} not found.`);
  return n;
};

function activeMedicine(req) {
  const med = medicines.getById(parseId(req.params.medicineId, 'Medicine'));
  if (!med.is_active) throw new HttpError(400, 'This medicine is deactivated. Reactivate it before changing stock.');
  return med;
}

const renderForm = (res, status, ctx) =>
  res.status(status).render('batches/form', { ...ctx });

// ---- Receive new batch ------------------------------------------------
router.get('/new', (req, res) => {
  const medicine = activeMedicine(req);
  renderForm(res, 200, {
    title: 'Receive stock',
    mode: 'create',
    medicine,
    action: `/medicines/${medicine.id}/batches`,
    values: {},
    errors: {},
    batch: null,
  });
});

router.post('/', (req, res) => {
  const medicine = activeMedicine(req);
  const result = svc.validate(req.body, { mode: 'create', medicineId: medicine.id });
  if (!result.ok) {
    return renderForm(res, 422, {
      title: 'Receive stock', mode: 'create', medicine,
      action: `/medicines/${medicine.id}/batches`,
      values: result.raw, errors: result.errors, batch: null,
    });
  }
  svc.createBatch(medicine.id, result.values);
  redirectWithFlash(res, `/medicines/${medicine.id}`, `Batch ${result.values.batch_number} received.`);
});

// ---- Edit batch --------------------------------------------------------
router.get('/:batchId/edit', (req, res) => {
  const medicine = activeMedicine(req);
  const batch = svc.getBatch(medicine.id, parseId(req.params.batchId, 'Batch'));
  renderForm(res, 200, {
    title: 'Edit batch',
    mode: 'edit',
    medicine,
    batch,
    action: `/medicines/${medicine.id}/batches/${batch.id}`,
    values: {
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      purchase_cost: toInputValue(batch.purchase_cost),
      selling_price: toInputValue(batch.selling_price),
      quantity: batch.quantity_on_hand,
      notes: batch.notes,
    },
    errors: {},
  });
});

router.post('/:batchId', (req, res) => {
  const medicine = activeMedicine(req);
  const batch = svc.getBatch(medicine.id, parseId(req.params.batchId, 'Batch'));
  const result = svc.validate(req.body, { mode: 'edit', medicineId: medicine.id, batchId: batch.id });
  if (!result.ok) {
    return renderForm(res, 422, {
      title: 'Edit batch', mode: 'edit', medicine, batch,
      action: `/medicines/${medicine.id}/batches/${batch.id}`,
      values: result.raw, errors: result.errors,
    });
  }
  svc.updateBatch(medicine.id, batch.id, result.values);
  redirectWithFlash(res, `/medicines/${medicine.id}`, 'Batch updated.');
});

// ---- Delete batch (only if never sold) ---------------------------------
router.post('/:batchId/delete', (req, res) => {
  const medicineId = activeMedicine(req).id;
  const result = svc.deleteBatch(medicineId, parseId(req.params.batchId, 'Batch'));
  if (!result.ok) return redirectWithFlash(res, `/medicines/${medicineId}`, result.reason, 'error');
  redirectWithFlash(res, `/medicines/${medicineId}`, 'Batch deleted.', 'info');
});

module.exports = router;
