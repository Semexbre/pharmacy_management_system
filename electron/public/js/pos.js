(function () {
  const $ = (id) => document.getElementById(id);
  const scan = $('scan'), results = $('results'), cartBody = $('cart-body'), cartEmpty = $('cart-empty');
  const discountEl = $('discount'), methodEl = $('method'), tenderedEl = $('tendered');
  const checkoutBtn = $('checkout'), msgEl = $('msg');

  const cart = new Map(); // medicine_id -> { id, name, detail, unit_price, price_varies, available, qty }
  let searchTimer = null, searchSeq = 0;
  let submitting = false;

  const fmt = (minor) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseMinor = (s) => {
    const raw = String(s || '').trim();
    if (raw === '') return 0;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
    const t = raw.replace(/,/g, '');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
    const [w, f = ''] = t.split('.');
    return parseInt(w, 10) * 100 + parseInt(f.padEnd(2, '0'), 10);
  };

  // ---------- messages ----------
  function showMsg(text, kind = 'error') {
    const styles = {
      error: 'mb-4 rounded-md border px-4 py-3 text-sm bg-red-50 border-red-300 text-red-800',
      success: 'mb-4 rounded-md border px-4 py-3 text-sm bg-emerald-50 border-emerald-300 text-emerald-800',
    };
    msgEl.className = styles[kind];
    msgEl.textContent = text;
  }
  const hideMsg = () => { msgEl.className = 'hidden'; };

  // ---------- cart ----------
  function addToCart(med) {
    if (submitting) return;
    hideMsg();
    if (med.available < 1 || med.unit_price === null) {
      return showMsg(`"${med.name}" has no sellable stock (out of stock or all batches expired).`);
    }
    const line = cart.get(med.id);
    if (line) {
      if (line.qty >= med.available) return showMsg(`Only ${med.available} of "${med.name}" available.`);
      line.qty += 1;
      line.available = med.available;
      line.price_tiers = med.price_tiers;
      line.unit_price = med.unit_price;
      line.price_varies = med.price_varies;
    } else {
      cart.set(med.id, {
        id: med.id,
        name: med.name,
        detail: [med.strength, med.dosage_form].filter(Boolean).join(' · '),
        unit_price: med.unit_price,
        price_varies: med.price_varies,
        price_tiers: med.price_tiers,
        available: med.available,
        qty: 1,
      });
    }
    render();
  }

  function setQty(id, qty) {
    if (submitting) return;
    const line = cart.get(id);
    if (!line) return;
    if (!Number.isInteger(qty) || qty < 1) qty = 1;
    if (qty > line.available) {
      qty = line.available;
      showMsg(`Only ${line.available} of "${line.name}" available.`);
    }
    line.qty = qty;
    render();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function render() {
    cartBody.replaceChildren();
    let subtotal = 0;

    for (const line of cart.values()) {
      const lineTotal = priceLine(line);
      subtotal += lineTotal;

      const tr = el('tr');

      const tdName = el('td', 'td');
      tdName.append(el('div', 'font-medium', line.name));
      if (line.detail) tdName.append(el('div', 'text-xs text-slate-500', line.detail));
      if (line.price_varies) tdName.append(el('div', 'text-xs text-amber-700', 'Total includes each batch price, earliest expiry first.'));

      const tdPrice = el('td', 'td text-right', fmt(line.unit_price));

      const tdQty = el('td', 'td text-center whitespace-nowrap');
      const minus = el('button', 'btn btn-secondary btn-sm', '−');
      const plus = el('button', 'btn btn-secondary btn-sm', '+');
      const qty = el('input', 'input w-16 mx-1 text-center py-1');
      qty.type = 'number'; qty.min = '1'; qty.max = String(line.available); qty.value = String(line.qty);
      minus.addEventListener('click', () => setQty(line.id, line.qty - 1));
      plus.addEventListener('click', () => setQty(line.id, line.qty + 1));
      qty.addEventListener('change', () => setQty(line.id, parseInt(qty.value, 10)));
      tdQty.append(minus, qty, plus);

      const tdTotal = el('td', 'td text-right font-semibold', fmt(lineTotal));

      const tdDel = el('td', 'td text-right');
      const del = el('button', 'btn btn-danger btn-sm', '✕');
      del.addEventListener('click', () => { if (!submitting) { cart.delete(line.id); render(); } });
      tdDel.append(del);

      tr.append(tdName, tdPrice, tdQty, tdTotal, tdDel);
      cartBody.append(tr);
    }

    cartEmpty.classList.toggle('hidden', cart.size > 0);
    updateTotals(subtotal);
  }

  function updateTotals(subtotal = currentSubtotal()) {
    const discount = parseMinor(discountEl.value);
    const discountOk = discount !== null && discount <= subtotal;
    const total = discountOk ? subtotal - discount : subtotal;

    $('subtotal').textContent = fmt(subtotal);
    $('total').textContent = fmt(total);
    discountEl.classList.toggle('input-error', !discountOk);

    const isCash = methodEl.value === 'cash';
    $('cash-box').classList.toggle('hidden', !isCash);
    const tendered = parseMinor(tenderedEl.value);
    const tenderOk = !isCash || (tenderedEl.value.trim() !== '' && tendered !== null && tendered >= total);
    $('change').textContent = isCash && tendered !== null ? fmt(Math.max(0, tendered - total)) : '0.00';

    checkoutBtn.disabled = submitting || !(cart.size > 0 && discountOk && tenderOk);
  }

  function priceLine(line) {
    let remaining = line.qty, total = 0;
    for (const tier of line.price_tiers) {
      const take = Math.min(remaining, tier.quantity);
      total += take * tier.unit_price;
      remaining -= take;
      if (!remaining) break;
    }
    return total;
  }

  function currentSubtotal() {
    let s = 0;
    for (const l of cart.values()) s += priceLine(l);
    return s;
  }

  // ---------- lookup ----------
  function hideResults() { searchSeq++; clearTimeout(searchTimer); results.classList.add('hidden'); results.replaceChildren(); }

  function showResults(list) {
    results.replaceChildren();
    if (list.length === 0) {
      results.append(el('li', 'px-4 py-3 text-sm text-slate-500', 'No matches.'));
    }
    for (const med of list) {
      const li = el('li', 'px-4 py-2 text-sm flex items-center justify-between cursor-pointer hover:bg-emerald-50');
      const left = el('div');
      left.append(el('div', 'font-medium', med.name));
      left.append(el('div', 'text-xs text-slate-500',
        [med.generic_name, med.strength, med.dosage_form].filter(Boolean).join(' · ')));
      const right = el('div', 'text-right');
      right.append(el('div', 'font-semibold', med.unit_price === null ? '—' : fmt(med.unit_price)));
      right.append(el('div', med.available > 0 ? 'text-xs text-slate-500' : 'text-xs text-red-600',
        med.available > 0 ? `${med.available} in stock` : 'No sellable stock'));
      li.append(left, right);
      li.addEventListener('click', () => { addToCart(med); scan.value = ''; hideResults(); scan.focus(); });
      results.append(li);
    }
    results.classList.remove('hidden');
  }

  async function runSearch(q) {
    const mySeq = ++searchSeq; // ignore out-of-order responses
    try {
      const res = await fetch('/pos/api/search?q=' + encodeURIComponent(q));
      const list = await res.json();
      if (mySeq === searchSeq) showResults(list);
    } catch (e) {
      if (mySeq === searchSeq) showMsg('Search failed.');
    }
  }

  scan.addEventListener('input', () => {
    searchSeq++;
    clearTimeout(searchTimer);
    const q = scan.value.trim();
    if (q.length < 2) return hideResults();
    searchTimer = setTimeout(() => runSearch(q), 200);
  });

  scan.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(searchTimer);
    searchSeq++; // cancel in-flight search renders
    const code = scan.value.trim();
    if (!code) return;

    try {
      const res = await fetch('/pos/api/lookup?barcode=' + encodeURIComponent(code));
      if (res.ok) {
        addToCart(await res.json());
        scan.value = '';
        hideResults();
      } else {
        await runSearch(code); // not a barcode: treat as a name search
      }
    } catch (err) {
      showMsg('Lookup failed.');
    }
  });

  // ---------- checkout ----------
  async function checkout() {
    if (submitting || checkoutBtn.disabled) return;
    submitting = true;
    checkoutBtn.disabled = true;
    hideMsg();

    const payload = {
      items: [...cart.values()].map((l) => ({ medicine_id: l.id, quantity: l.qty })),
      discount: discountEl.value,
      payment_method: methodEl.value,
      amount_tendered: tenderedEl.value,
    };

    try {
      const res = await fetch('/pos/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || 'Checkout failed.');
        submitting = false;
        updateTotals();
        return;
      }
      window.location.href = '/pos/receipt/' + data.saleId;
    } catch (err) {
      showMsg('Could not reach the local server.');
      submitting = false;
      updateTotals();
    }
  }

  checkoutBtn.addEventListener('click', checkout);
  $('clear').addEventListener('click', () => {
    if (submitting) return;
    if (cart.size === 0 || window.confirm('Clear the cart?')) {
      cart.clear(); discountEl.value = ''; tenderedEl.value = ''; hideMsg(); render(); scan.focus();
    }
  });
  [discountEl, tenderedEl].forEach((i) => i.addEventListener('input', () => updateTotals()));
  methodEl.addEventListener('change', () => updateTotals());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); scan.focus(); scan.select(); }
    if (e.key === 'F9') { e.preventDefault(); checkout(); }
    if (e.key === 'Escape') { hideResults(); scan.focus(); }
  });

  render();
})();
