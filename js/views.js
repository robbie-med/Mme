// View state (current tab + derivation expansion) and view switching.
// Notifies subscribers on view change so main.js can wire render + syncHash.

export const VIEWS = ['simple', 'complex', 'about', 'settings'];
export const view = { current: 'simple' };

// Per-row + per-total derivation expansion state. Shared across view switches.
export const expandedRows = new Set();
export const viewState = { totalExpanded: false };
export function setTotalExpanded(b) { viewState.totalExpanded = b; }

const subscribers = [];
export function onViewChange(fn) { subscribers.push(fn); }

export function setView(v) {
  if (!VIEWS.includes(v)) v = 'simple';
  view.current = v;
  document.body.classList.remove('view-simple', 'view-complex', 'view-about', 'view-settings');
  document.body.classList.add('view-' + v);
  document.querySelectorAll('.view-tab').forEach(btn => {
    const active = btn.dataset.view === v;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  subscribers.forEach(s => s());
}
