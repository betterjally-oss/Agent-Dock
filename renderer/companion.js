const companion = document.getElementById('companion');
const quote = document.getElementById('companion-quote');
let responseTimer = null;

window.notchAPI?.onCompanionState?.((payload) => {
  const state = ['rest', 'focus', 'celebrate', 'peek', 'attention'].includes(payload?.state)
    ? payload.state
    : 'hidden';
  const notchHeight = Math.max(30, Math.min(56, Number(payload?.notchHeight) || 38));
  document.documentElement.style.setProperty('--notch-h', `${notchHeight}px`);
  companion.dataset.state = state;
  companion.setAttribute('aria-hidden', String(state === 'hidden'));
  quote.textContent = state === 'celebrate' ? String(payload?.message || '') : '';
});

window.notchAPI?.onCompanionInteract?.(() => {
  if (companion.dataset.state !== 'rest') return;
  clearTimeout(responseTimer);
  companion.classList.remove('responding');
  void companion.offsetWidth;
  companion.classList.add('responding');
  responseTimer = setTimeout(() => companion.classList.remove('responding'), 380);
});
