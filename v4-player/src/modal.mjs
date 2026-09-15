// Simple modal overlay (no framework).
export function openModal(html) {
  const existing = document.getElementById('app-modal');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'app-modal';
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="modal-card">${html}<button type="button" class="app-button" data-modal-close>關閉</button></div>`;
  el.addEventListener('click', (event) => {
    if (event.target === el || event.target.closest('[data-modal-close]')) el.remove();
  });
  document.body.appendChild(el);
  el.querySelector('[data-modal-close]')?.focus();
  return el;
}

export function closeModal() {
  document.getElementById('app-modal')?.remove();
}
