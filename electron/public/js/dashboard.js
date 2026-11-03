(() => {
  const root = document.getElementById('dashboard');
  if (!root) return;
  const byId = id => document.getElementById(id);
  function element(tag, text, classes = '') {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    node.className = classes;
    return node;
  }
  function svgElement(tag, attrs = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const empty = text => element('p', text, 'text-sm text-slate-500 py-6');
  const palette = ['#047857', '#d97706', '#dc2626', '#475569'];
  function donut(id, rows, totalLabel, description) {
    const container = byId(id);
    container.replaceChildren();
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const chart = svgElement('svg', { viewBox: '0 0 220 180', role: 'img', 'aria-label': description, class: 'w-full h-44 mt-3' });
    chart.append(svgElement('title', {}, description));
    chart.append(svgElement('circle', { cx: 110, cy: 87, r: 62, fill: 'none', stroke: '#e2e8f0', 'stroke-width': 18 }));
    let offset = 0;
    rows.forEach((row, index) => {
      if (!total || !row.value) return;
      const length = row.value / total * 100;
      const segment = svgElement('circle', { cx: 110, cy: 87, r: 62, fill: 'none', stroke: palette[index], 'stroke-width': 18,
        pathLength: 100, 'stroke-dasharray': `${length} ${100 - length}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 110 87)' });
      segment.append(svgElement('title', {}, `${row.label}: ${row.formatted ?? row.value}`));
      chart.append(segment); offset += length;
    });
    chart.append(svgElement('text', { x: 110, y: 86, 'text-anchor': 'middle', fill: '#0f172a', 'font-size': totalLabel.length > 12 ? 12 : 18, 'font-weight': 700 }, totalLabel));
    chart.append(svgElement('text', { x: 110, y: 106, 'text-anchor': 'middle', fill: '#64748b', 'font-size': 11 }, 'Total'));
    container.append(chart);
    const legend = element('ul', undefined, 'space-y-2 text-sm');
    rows.forEach((row, index) => {
      const item = element('li', undefined, 'flex justify-between gap-2');
      const label = element('span', undefined, 'flex items-center gap-2');
      const dot = element('span', '', 'inline-block w-2 h-2 rounded-full'); dot.style.backgroundColor = palette[index];
      label.append(dot, element('span', row.label)); item.append(label, element('span', row.formatted ?? row.value, 'font-semibold'));
      legend.append(item);
    });
    container.append(legend);
    if (!total) container.append(empty('No data yet for this summary.'));
  }
  function salesChart(rows) {
    const container = byId('sales-chart'); container.replaceChildren();
    const maximum = Math.max(...rows.map(row => row.value), 0);
    const chart = svgElement('svg', { viewBox: '0 0 700 240', role: 'group', 'aria-label': 'Daily sales. Focus a point for the date and total.', class: 'w-full h-60' });
    const x = index => rows.length === 1 ? 385 : 80 + index / (rows.length - 1) * 600;
    const y = value => 195 - value / (maximum || 1) * 160;
    [35, 115, 195].forEach(height => chart.append(svgElement('line', { x1: 80, y1: height, x2: 680, y2: height, stroke: '#e2e8f0', 'stroke-dasharray': '4 4' })));
    chart.append(svgElement('text', { x: 72, y: 39, 'text-anchor': 'end', fill: '#64748b', 'font-size': 10 }, rows.find(row => row.value === maximum)?.formatted || '0.00'));
    chart.append(svgElement('text', { x: 72, y: 199, 'text-anchor': 'end', fill: '#64748b', 'font-size': 10 }, '0.00'));
    const points = rows.map((row, i) => `${x(i)},${y(row.value)}`).join(' ');
    if (maximum) chart.append(svgElement('polygon', { points: `${x(0)},195 ${points} ${x(rows.length - 1)},195`, fill: '#d1fae5', opacity: '.65' }));
    chart.append(svgElement('polyline', { points, fill: 'none', stroke: '#047857', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    rows.forEach((row, i) => {
      const label = `${row.day}: ${row.formatted}`;
      const point = svgElement('circle', { cx: x(i), cy: y(row.value), r: 5, fill: '#047857', stroke: '#ffffff', 'stroke-width': 2, tabindex: 0, role: 'img', 'aria-label': label });
      point.append(svgElement('title', {}, label));
      const show = () => { byId('sales-tooltip').textContent = label; };
      point.addEventListener('mouseenter', show); point.addEventListener('focus', show);
      chart.append(point);
      if (i === 0 || i === rows.length - 1 || i === Math.floor(rows.length / 2)) chart.append(svgElement('text', { x: x(i), y: 225, 'text-anchor': 'middle', fill: '#64748b', 'font-size': 11 }, row.day.slice(5)));
    });
    container.append(chart);
    if (!maximum) byId('sales-tooltip').textContent = 'No completed sales in this period. Your next sale will appear here.';
  }
  function render(data) {
    byId('range-caption').textContent = `${data.range.dates[0]} – ${data.range.dates.at(-1)} · Compared with the previous ${data.range.dates.length} days`;
    for (const [key, item] of Object.entries(data.kpis)) {
      const value = root.querySelector(`[data-kpi="${key}"]`);
      if (!value) continue;
      value.textContent = item.formatted ?? item.value.toLocaleString();
      const change = root.querySelector(`[data-change="${key}"]`);
      change.className = `text-xs mt-2 ${item.change > 0 ? 'text-emerald-700' : item.change < 0 ? 'text-red-700' : 'text-slate-500'}`;
      change.textContent = item.note ? `— ${item.note}` : item.change === null ? '— No previous-period baseline' : `${item.change > 0 ? '+' : ''}${item.change}% vs previous period`;
    }
    for (const [key, count] of Object.entries(data.alerts)) {
      document.querySelectorAll(`[data-alert-count="${key}"]`).forEach(node => {
        node.textContent = count;
        if (node.parentElement.hasAttribute('aria-label')) node.parentElement.setAttribute('aria-label', `${count} ${key === 'low' ? 'low-stock medicines' : key === 'near' ? 'near-expiry batches' : 'expired batches'}`);
      });
    }
    salesChart(data.daily);
    const top = byId('top-sellers'); top.replaceChildren();
    data.top.forEach((row, i) => {
      const item = element('li', undefined, 'flex gap-3 py-3 items-center');
      item.append(element('span', String(i + 1).padStart(2, '0'), 'text-sm text-slate-400 font-semibold'));
      const info = element('div', undefined, 'min-w-0 flex-1');
      info.append(element('p', row.name, 'font-medium text-sm break-words'), element('p', `${row.quantity} units sold`, 'text-xs text-slate-500 mt-1'));
      item.append(info, element('span', row.revenue.formatted, 'text-sm font-semibold')); top.append(item);
    });
    if (!data.top.length) top.append(element('li', 'No medicines sold in this period.', 'text-sm text-slate-500 py-6'));
    donut('stock-chart', [{ label: 'In stock', value: data.stock.inStock }, { label: 'Low stock', value: data.stock.low }, { label: 'Out of stock', value: data.stock.out }], String(data.stock.total), 'Medicine stock categories; low stock excludes out-of-stock items.');
    const expired = byId('expired-count');
    expired.textContent = data.stock.expired ? `${data.stock.expired} expired batches still hold stock · Review for write-off` : 'No expired batches with stock on hand.';
    expired.className = `text-sm mt-4 rounded-lg p-3 ${data.stock.expired ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`;
    const expiry = byId('expiry-list'); expiry.replaceChildren();
    data.expiry.forEach(row => {
      const item = element('li', undefined, 'flex items-center justify-between gap-3 py-3');
      const info = element('div', undefined, 'min-w-0');
      info.append(element('p', row.name, 'font-medium text-sm break-words'), element('p', `Batch ${row.batch_number} · ${row.expiry_date}`, 'text-xs text-slate-500 mt-1 break-words'));
      item.append(info, element('span', row.days_left < 0 ? `Expired ${-row.days_left}d ago` : row.days_left === 0 ? 'Expires today' : `${row.days_left} days left`, `badge shrink-0 ${row.days_left <= 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`));
      expiry.append(item);
    });
    if (!data.expiry.length) expiry.append(element('li', 'No stocked batches expiring in this window.', 'text-sm text-slate-500 py-6'));
    const recent = byId('recent-sales'); recent.replaceChildren();
    data.recent.forEach(row => {
      const tr = element('tr', undefined, 'border-b border-slate-100');
      const receipt = element('td', undefined, 'py-3 pr-3 break-words');
      const link = element(row.receiptUrl ? 'a' : 'span', row.receipt, 'font-medium text-emerald-800');
      if (row.receiptUrl) { link.href = row.receiptUrl; link.classList.add('hover:underline'); }
      receipt.append(link, element('p', new Date(row.createdAt).toLocaleString(), 'text-xs text-slate-500 mt-1'));
      tr.append(receipt, element('td', row.cashier, 'py-3 pr-3 break-words'), element('td', row.total.formatted, 'py-3 text-right font-semibold break-words')); recent.append(tr);
    });
    if (!data.recent.length) { const row = element('tr'); const cell = element('td', 'No completed transactions in this period.', 'py-6 text-slate-500'); cell.colSpan = 3; row.append(cell); recent.append(row); }
    donut('payment-chart', data.payments.map(row => ({ label: row.method[0].toUpperCase() + row.method.slice(1), value: row.value, formatted: row.formatted })), data.business.revenue.formatted, 'Revenue by payment method');
    const business = byId('business-summary'); business.replaceChildren();
    const fields = [['revenue', 'Revenue'], ['cost', 'Cost of goods'], ['profit', 'Gross profit'], ['margin', 'Gross margin'], ['transactions', 'Transactions']];
    fields.forEach(([key, label]) => {
      if (!(key in data.business)) return;
      const value = data.business[key];
      const item = element('div', undefined, 'min-w-0');
      item.append(element('dt', label, 'text-xs text-emerald-200'), element('dd', key === 'margin' ? value === null ? '—' : `${value}%` : value?.formatted ?? String(value), 'text-xl font-semibold mt-1 break-words'));
      business.append(item);
    });
  }
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true; root.setAttribute('aria-busy', 'true');
    byId('dashboard-retry').classList.add('hidden');
    try {
      const response = await fetch(`/dashboard/api/summary?${new URLSearchParams({ range: root.dataset.range, days: root.dataset.days })}`);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Dashboard unavailable. Reload the page to check your session, or retry.');
      render(await response.json());
      byId('dashboard-status').textContent = 'Dashboard updated from local data.';
      byId('dashboard-status').className = 'sr-only';
      root.dataset.loaded = 'true';
    } catch (error) {
      byId('dashboard-status').textContent = error.message;
      byId('dashboard-status').className = 'text-sm text-red-700';
      byId('dashboard-retry').classList.remove('hidden');
    } finally { loading = false; root.setAttribute('aria-busy', 'false'); }
  }
  byId('dashboard-retry').addEventListener('click', load);
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  load();
})();
