// 1. Confirm dialogs: <form data-confirm="Are you sure?">
// Print buttons: <button data-print>
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset && e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// 2. Strip ?msg=&type= after a flash is shown so a reload doesn't repeat it
(function cleanFlashParams() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('msg')) {
    url.searchParams.delete('msg');
    url.searchParams.delete('type');
    window.history.replaceState({}, '', url.pathname + url.search);
  }
})();

// 3. Dashboard health check (Phase 1)
(async function healthCheck() {
  const el = document.getElementById('server-status');
  if (!el) return;
  try {
    const res = await fetch('/health');
    const data = await res.json();
    el.textContent = `OK · up ${Math.round(data.uptime)}s`;
    el.classList.replace('text-slate-400', 'text-emerald-600');
  } catch (err) {
    el.textContent = 'Unreachable';
    el.classList.replace('text-slate-400', 'text-red-600');
  }
})();