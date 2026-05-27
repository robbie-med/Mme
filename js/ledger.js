// Ledger state + mutations + persistence. Notifies subscribers on change
// so render/syncHash can be wired in main.js without circular imports.
import { settings, LEDGER_KEY } from './settings.js';
import { drugUnit, ROUTE_LABELS } from './drugs.js';
import { formatNum } from './mme.js';

export const ledger = [];
let nextId = 1;

const subscribers = [];
export function onLedgerChange(fn) { subscribers.push(fn); }
function notify() { subscribers.forEach(s => s()); }

export function saveLedger() {
  try {
    if (settings.persist) localStorage.setItem(LEDGER_KEY, JSON.stringify({ ledger, nextId }));
    else localStorage.removeItem(LEDGER_KEY);
  } catch (e) {}
}
export function loadLedger() {
  if (!settings.persist) return;
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.ledger)) {
      ledger.length = 0;
      data.ledger.forEach(e => ledger.push(e));
      nextId = data.nextId || (Math.max(0, ...ledger.map(e => e.id)) + 1);
    }
  } catch (e) {}
}

export function addManualEntry({ drug, route, dose, perDay }) {
  const u = drugUnit(drug);
  const ts = Date.now();
  const admins = [];
  if (drug === 'fentanyl' && route === 'TD') {
    admins.push({ date: '', time: '', dose, unit: 'mcg', ts });
  } else {
    admins.push({ date: '', time: '', dose: dose * perDay, unit: u, ts });
  }
  const label = (drug === 'fentanyl' && route === 'TD')
    ? `${formatNum(dose)} mcg/hr patch`
    : `${formatNum(dose)} ${u} × ${formatNum(perDay)}/day`;
  ledger.push({ id: nextId++, source: 'manual', drug, route, label, strengthUnit: u, admins, _dose: dose, _perDay: perDay });
  saveLedger();
  notify();
}

export function addParsedOrders(orders) {
  orders.forEach(o => {
    ledger.push({
      id: nextId++, source: 'parsed', drug: o.drug, route: o.route,
      label: `${formatNum(o.strength)} ${o.strengthUnit}${o.route !== 'TD' ? ` ${ROUTE_LABELS[o.route] || o.route}` : ' patch'} — ${o.admins.length} dose${o.admins.length === 1 ? '' : 's'} on file`,
      strengthUnit: o.strengthUnit, admins: o.admins,
    });
  });
  saveLedger();
  notify();
}

export function removeEntry(id) {
  const i = ledger.findIndex(e => e.id === id);
  if (i >= 0) ledger.splice(i, 1);
  saveLedger();
  notify();
}
export function clearAll() {
  if (ledger.length > 0 && !confirm('Remove all medications from the list?')) return;
  ledger.length = 0;
  saveLedger();
  notify();
}

// Used by Settings → Reset, which clears storage explicitly.
export function resetLedger() {
  ledger.length = 0;
  nextId = 1;
  notify();
}
