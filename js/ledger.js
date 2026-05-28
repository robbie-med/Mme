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

// PCA = patient-controlled analgesia: basal infusion + demand boluses.
// Effective daily dose = basal × 24 + demand × average demands/day.
// Stored as a normal ledger entry whose admins carries the effective daily,
// plus _basal/_demand/_demands/_lockout fields so the label and any future
// export-as-PCA-order can reconstruct the breakdown.
export function addPCAEntry({ drug, route, basal, demand, demands, lockout }) {
  const u = drugUnit(drug);
  const effDaily = (basal || 0) * 24 + (demand || 0) * (demands || 0);
  const ts = Date.now();
  const lockoutTxt = (lockout != null && lockout > 0) ? ` q${lockout}min` : '';
  const label = `PCA: ${formatNum(basal)} ${u}/hr basal + ${formatNum(demand)} ${u}${lockoutTxt} demand (avg ${formatNum(demands)}/day) → ${formatNum(effDaily)} ${u}/day`;
  ledger.push({
    id: nextId++, source: 'pca', drug, route, label, strengthUnit: u,
    admins: [{ date: '', time: '', dose: effDaily, unit: u, ts }],
    _mode: 'pca',
    _basal: basal, _demand: demand, _demands: demands, _lockout: lockout,
    // Keep a derived _dose/_perDay so hash + computeEntryMME treat it like a
    // manual entry with daily total. The breakdown survives via _basal etc.
    _dose: effDaily, _perDay: 1,
  });
  saveLedger();
  notify();
}

export function addParsedOrders(orders) {
  orders.forEach(o => {
    ledger.push({
      id: nextId++, source: 'parsed', drug: o.drug, route: o.route,
      label: `${formatNum(o.strength)} ${o.strengthUnit}${o.route !== 'TD' ? ` ${ROUTE_LABELS[o.route] || o.route}` : ' patch'} · ${o.admins.length} dose${o.admins.length === 1 ? '' : 's'} on file`,
      strengthUnit: o.strengthUnit, admins: o.admins,
    });
  });
  saveLedger();
  notify();
}

// Edit a single admin's timestamp. Parsed-MAR entries already have one admin
// per real dose, so this just rewrites that admin's ts. Manual / PCA entries
// store a single admin holding the daily total; the first edit "materialises"
// the synthetic schedule into N per-dose admins (per perDay) so subsequent
// edits address discrete doses. Once materialised the entry is marked
// _timesSet so collectDoses stops re-synthesising it.
export function setAdminTime(entryId, adminIdx, newTs) {
  const entry = ledger.find(e => e.id === entryId);
  if (!entry || !Number.isFinite(newTs)) return;
  if (entry.source !== 'parsed' && !entry._timesSet) {
    if (entry.drug === 'fentanyl' && entry.route === 'TD') {
      // Single-admin patch: just mark; the existing admin holds the rate.
      entry._timesSet = true;
    } else {
      const perDay = Math.max(1, Math.round(entry._perDay || entry._demands || 1));
      const perDose = entry._dose != null
        ? entry._dose
        : (entry.admins[0] ? entry.admins[0].dose / perDay : 0);
      const u = entry.admins[0] ? entry.admins[0].unit : (entry.strengthUnit || 'mg');
      const intervalMs = (24 * 3600 * 1000) / perDay;
      const last = Date.now() - 30 * 60 * 1000;
      entry.admins = [];
      for (let i = 0; i < perDay; i++) {
        entry.admins.push({ date: '', time: '', dose: perDose, unit: u, ts: last - i * intervalMs });
      }
      entry._timesSet = true;
    }
  }
  if (entry.admins[adminIdx]) {
    entry.admins[adminIdx].ts = newTs;
  }
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
