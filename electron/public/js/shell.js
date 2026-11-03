(() => {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!toggle || !sidebar) return;
  function setOpen(open) {
    sidebar.classList.toggle('hidden', !open);
    sidebar.classList.toggle('flex', open);
    overlay.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('a').focus();
    else toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  overlay.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('a, button')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  matchMedia('(min-width: 1280px)').addEventListener('change', () => {
    sidebar.classList.add('hidden'); sidebar.classList.remove('flex');
    overlay.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false');
  });
})();
