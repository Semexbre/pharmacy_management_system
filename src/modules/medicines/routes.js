const express = require('express');
const svc = require('./service');
const { redirectWithFlash } = require('../../utils/flash');
const { HttpError } = require('../../utils/httpError');

const router = express.Router();

const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Medicine not found.');
  return n;
};

const DOSAGE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Sachet'];

// ---- List + search -------------------------------------------------
router.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const status = ['active', 'inactive', 'all'].includes(req.query.status) ? req.query.status : 'active';
  const result = svc.list({ q, status, page: parseInt(req.query.page, 10) || 1 });

  res.render('medicines/index', {
    title: 'Inventory',
    q,
    status,
    baseQuery: new URLSearchParams({ q, status }).toString(),
    ...result,
  });
});

// ---- Create --------------------------------------------------------
router.get('/new', (req, res) => {
  res.render('medicines/form', {
    title: 'Add medicine',
    heading: 'Add medicine',
    action: '/medicines',
    submitLabel: 'Save medicine',
    cancelHref: '/medicines',
    values: { reorder_level: 10 },
    errors: {},
    dosageForms: DOSAGE_FORMS,
  });
});

router.post('/', (req, res) => {
  const result = svc.validate(req.body);
  if (!result.ok) {
    return res.status(422).render('medicines/form', {
      title: 'Add medicine',
      heading: 'Add medicine',
      action: '/medicines',
      submitLabel: 'Save medicine',
      cancelHref: '/medicines',
      values: result.raw,
      errors: result.errors,
      dosageForms: DOSAGE_FORMS,
    });
  }
  const id = svc.create(result.values);
  redirectWithFlash(res, `/medicines/${id}`, 'Medicine added. Receive its first batch below.');
});

// ---- Detail (with batches) ------------------------------------------
router.get('/:id', (req, res) => {
  const data = svc.getWithBatches(parseId(req.params.id));
  res.render('medicines/show', { title: data.medicine.name, ...data });
});

// ---- Edit ----------------------------------------------------------
router.get('/:id/edit', (req, res) => {
  const medicine = svc.getById(parseId(req.params.id));
  res.render('medicines/form', {
    title: `Edit ${medicine.name}`,
    heading: `Edit ${medicine.name}`,
    action: `/medicines/${medicine.id}`,
    submitLabel: 'Save changes',
    cancelHref: `/medicines/${medicine.id}`,
    values: medicine,
    errors: {},
    dosageForms: DOSAGE_FORMS,
  });
});

router.post('/:id', (req, res) => {
  const id = parseId(req.params.id);
  svc.getById(id); // 404 if missing
  const result = svc.validate(req.body, { id });
  if (!result.ok) {
    return res.status(422).render('medicines/form', {
      title: 'Edit medicine',
      heading: 'Edit medicine',
      action: `/medicines/${id}`,
      submitLabel: 'Save changes',
      cancelHref: `/medicines/${id}`,
      values: result.raw,
      errors: result.errors,
      dosageForms: DOSAGE_FORMS,
    });
  }
  svc.update(id, result.values);
  redirectWithFlash(res, `/medicines/${id}`, 'Medicine updated.');
});

// ---- Activate / deactivate (soft delete) ----------------------------
router.post('/:id/toggle', (req, res) => {
  const id = parseId(req.params.id);
  const med = svc.getById(id);
  svc.setActive(id, !med.is_active);
  redirectWithFlash(res, `/medicines/${id}`, med.is_active ? 'Medicine deactivated.' : 'Medicine reactivated.', 'info');
});

module.exports = router;