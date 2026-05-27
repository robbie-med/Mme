// Entry point. Loads state, wires UI, and connects ledger/view changes
// to render + hash sync via the subscribe hooks each module exposes.

import { DRUGS } from './drugs.js';
import {
  TABLES, DEFAULT_TABLE,
} from './tables.js';
import {
  SETTINGS_KEY, LEDGER_KEY, CONTEXT_KEY,
  settings, loadSettings, saveSettings,
  patientContext, loadContext, saveContext, clearPatientContext,
} from './settings.js';
import { parseMAR } from './mar-parser.js';
import {
  ledger, loadLedger, saveLedger, addParsedOrders, clearAll, resetLedger,
  onLedgerChange,
} from './ledger.js';
import { view, setView, onViewChange } from './views.js';
import { render } from './render.js';
import {
  populateDrugSelect, updateRouteOptions, updateDoseLabels,
  handleAdd, flashHelp, applyContextToUI, wirePatientContext,
  applyAddMode,
} from './form.js';
import { syncHash, loadFromHash, wireExport } from './share.js';
import { wirePWA } from './pwa.js';

const EXAMPLE = `HYDROmorphone (Dilaudid inj)
0.5 mg, 0.25 mL, IV, q3 hr, PRN: Moderate to Severe Pain
Started: Sikora MD, Kenneth R (IHI) 5/25/26 • 07:02
Ended: 5/25/26 • 22:55
5/25/26
20:35
0.5 mg
5/25/26
18:02
0.5 mg
5/25/26
15:21
0.5 mg
5/25/26
12:42
0.5 mg
5/25/26
09:45
0.5 mg
0.75 mg, 0.38 mL, IV, q2 hr, PRN: Moderate to Severe Pain
5/25/26
05:26
0.75 mg
5/25/26
02:24
0.75 mg
5/24/26
22:14
0.75 mg

oxyCODONE (Roxicodone)
5 mg, 1 Tab, PO, q4 hr, PRN: Moderate Pain
5/25/26
14:20
5 mg
5/25/26
08:00
5 mg

fentanyl (Duragesic patch)
25 mcg/hr, transdermal, q72 hr
5/24/26
08:00
25 mcg
`;

function applySettingsToUI() {
  document.getElementById('setting-default-view').value = settings.defaultView;
  document.getElementById('setting-persist').checked = !!settings.persist;
  const tableSel = document.getElementById('setting-table');
  if (tableSel) tableSel.value = TABLES[settings.activeTable] ? settings.activeTable : DEFAULT_TABLE;
  applyContextToUI();
}

function wireSettings() {
  document.getElementById('setting-default-view').addEventListener('change', e => {
    settings.defaultView = e.target.value;
    saveSettings();
  });
  document.getElementById('setting-persist').addEventListener('change', e => {
    settings.persist = e.target.checked;
    saveSettings();
    saveLedger();
    saveContext();
  });
  const tableSel = document.getElementById('setting-table');
  if (tableSel) tableSel.addEventListener('change', e => {
    if (TABLES[e.target.value]) {
      settings.activeTable = e.target.value;
      saveSettings();
      syncHash();
      render();
    }
  });
  document.getElementById('setting-reset').addEventListener('click', () => {
    if (!confirm('Reset settings and remove all saved medications and patient context? This cannot be undone.')) return;
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(LEDGER_KEY);
      localStorage.removeItem(CONTEXT_KEY);
    } catch (e) {}
    settings.defaultView = 'simple';
    settings.persist = true;
    settings.activeTable = DEFAULT_TABLE;
    clearPatientContext();
    resetLedger();
    applySettingsToUI();
    setView('simple');
  });
}

function init() {
  loadSettings();
  loadLedger();
  loadContext();

  // Drug + route selects
  populateDrugSelect();
  updateRouteOptions();
  updateDoseLabels();

  document.getElementById('add-drug').addEventListener('change', () => { updateRouteOptions(); updateDoseLabels(); });
  document.getElementById('add-route').addEventListener('change', updateDoseLabels);
  document.getElementById('add-btn').addEventListener('click', handleAdd);
  document.getElementById('add-dose').addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  document.getElementById('add-freq').addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  // PCA-mode toggle + Enter-to-submit in PCA fields
  document.querySelectorAll('input[name="add-mode"]').forEach(r =>
    r.addEventListener('change', applyAddMode));
  ['pca-basal', 'pca-demand', 'pca-demands', 'pca-lockout'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  });
  applyAddMode();

  // Paste MAR
  document.getElementById('parse-btn').addEventListener('click', () => {
    const text = document.getElementById('input-text').value;
    const { orders, warnings } = parseMAR(text);
    if (!orders.length) { flashHelp(warnings.length ? warnings[0] : 'No medications detected in pasted text.'); return; }
    addParsedOrders(orders);
  });
  document.getElementById('example-btn').addEventListener('click', () => { document.getElementById('input-text').value = EXAMPLE; });
  document.getElementById('clear-text-btn').addEventListener('click', () => { document.getElementById('input-text').value = ''; });

  // Complex window controls
  document.getElementById('time-window').addEventListener('change', render);
  document.getElementById('window-anchor').addEventListener('change', render);

  // Clear all (two buttons, simple + complex)
  document.getElementById('simple-clear-btn').addEventListener('click', clearAll);
  document.getElementById('complex-clear-btn').addEventListener('click', clearAll);

  // Convert
  document.getElementById('target-drug').addEventListener('change', () => { syncHash(); render(); });
  document.getElementById('reduction').addEventListener('change', () => { syncHash(); render(); });

  // View tabs
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => { setView(btn.dataset.view); syncHash(); });
  });

  // Settings + patient context + PWA + export
  applySettingsToUI();
  wireSettings();
  wirePatientContext(() => { /* render triggers via context save; explicit call below */ render(); });
  wirePWA();
  wireExport();

  // Ledger/view changes -> render + hash sync
  onLedgerChange(syncHash);
  onLedgerChange(render);
  onViewChange(render);

  // URL hash takes priority for the initial state.
  let initialView = settings.defaultView;
  const hashLoaded = loadFromHash();
  if (hashLoaded) initialView = view.current || initialView;
  applySettingsToUI();
  setView(initialView);
  syncHash();

  window.addEventListener('hashchange', () => {
    const ok = loadFromHash();
    if (ok) render();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
