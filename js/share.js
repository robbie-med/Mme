// URL hash sync, copy-as-URL, copy-as-EHR-note, print, clipboard helper.
import { DRUGS, ROUTE_LABELS } from './drugs.js';
import {
  TABLES, DEFAULT_TABLE, getActiveTable, getFactor, methadoneOutFactor,
} from './tables.js';
import { settings } from './settings.js';
import { ledger, addManualEntry } from './ledger.js';
import { filterAdminsByWindow, formatNum } from './mme.js';
import { view, VIEWS } from './views.js';
import { buildConversionOrders } from './conversion.js';
import { getRiskTier, buildSafetyAlerts } from './safety.js';
import { getRowsForActiveView } from './render.js';

let suppressHashSync = false;

function entryDailyDose(entry) {
  if (entry.source === 'manual' && entry._dose != null) {
    return { dose: entry._dose, perDay: entry._perDay || 1 };
  }
  // Parsed entry: compute its all-window normalized daily contribution.
  const all = filterAdminsByWindow(entry.admins, 'all', Date.now());
  if (all.kept.length === 0) return { dose: 0, perDay: 1 };
  let total = all.kept.reduce((s, a) => s + a.dose, 0);
  let spanH = 0;
  if (all.kept.length > 1) {
    spanH = (Math.max(...all.kept.map(a => a.ts)) - Math.min(...all.kept.map(a => a.ts))) / 3600000;
  }
  if (spanH > 24) total = (total * 24) / spanH;
  if (entry.drug === 'fentanyl' && entry.route === 'TD') {
    const latest = all.kept.reduce((a, b) => a.ts > b.ts ? a : b);
    return { dose: latest.dose, perDay: 1 };
  }
  return { dose: total, perDay: 1 };
}

export function buildShareHash() {
  const items = ledger.map(e => {
    const { dose, perDay } = entryDailyDose(e);
    return [e.drug, e.route, +dose.toFixed(4), +perDay.toFixed(4)].join('|');
  }).filter(s => s);
  const target = (document.getElementById('target-drug') || {}).value || '';
  const rx = (document.getElementById('reduction') || {}).value || '';
  const parts = [];
  if (items.length) parts.push('m=' + items.join(';'));
  if (target) parts.push('t=' + target);
  if (rx) parts.push('rx=' + rx);
  if (view.current && view.current !== settings.defaultView) parts.push('v=' + view.current);
  if (settings.activeTable && settings.activeTable !== DEFAULT_TABLE) {
    parts.push('tbl=' + settings.activeTable);
  }
  return parts.join('&');
}

export function syncHash() {
  if (suppressHashSync) return;
  const newHash = buildShareHash();
  const want = newHash ? '#' + newHash : '';
  if (location.hash === want) return;
  try { history.replaceState(null, '', want || location.pathname + location.search); }
  catch (e) { location.hash = newHash; }
}

export function loadFromHash() {
  if (!location.hash || location.hash.length < 2) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const m = params.get('m');
  let loaded = false;
  if (m) {
    suppressHashSync = true;
    ledger.length = 0;
    m.split(';').forEach(item => {
      const [drug, route, doseStr, perDayStr] = item.split('|');
      const dose = parseFloat(doseStr);
      const perDay = parseFloat(perDayStr) || 1;
      if (!DRUGS[drug] || !isFinite(dose) || dose <= 0) return;
      if (getFactor(drug, route) == null) return;
      addManualEntry({ drug, route, dose, perDay });
    });
    suppressHashSync = false;
    loaded = true;
  }
  const t = params.get('t');
  if (t) {
    const sel = document.getElementById('target-drug');
    if (sel) sel.value = t;
  }
  const rx = params.get('rx');
  if (rx) {
    const sel = document.getElementById('reduction');
    if (sel) sel.value = rx;
  }
  const v = params.get('v');
  if (v && VIEWS.includes(v)) view.current = v;
  const tbl = params.get('tbl');
  if (tbl && TABLES[tbl]) settings.activeTable = tbl;
  return loaded;
}

function buildClinicalNote(rows, totalMME) {
  const lines = [];
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  lines.push(`MME Calculator — ${stamp}`);
  lines.push('');
  lines.push('Current regimen:');
  if (!rows.length) lines.push('  (none)');
  else rows.forEach(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    const route = ROUTE_LABELS[e.route] || e.route;
    const mme = r.mme == null ? '—' : formatNum(r.mme);
    lines.push(`  • ${drug} ${route} — ${e.label || ''} → ${mme} MME/day`);
  });
  lines.push('');
  const tier = getRiskTier(totalMME);
  const tierLabel = tier.label + (totalMME > 0 ? ` (${tier.explain})` : '');
  lines.push(`Total: ${formatNum(totalMME)} MME / day  [${tierLabel}]`);

  const targetSel = document.getElementById('target-drug');
  const reductionSel = document.getElementById('reduction');
  if (targetSel && targetSel.value && totalMME > 0) {
    const [drugKey, route] = targetSel.value.split('|');
    const reduction = Number(reductionSel.value) / 100;
    const adjMME = totalMME * (1 - reduction);
    let dose, unit;
    if (drugKey === 'methadone' && route === 'PO') {
      const ratio = methadoneOutFactor(adjMME);
      dose = adjMME / ratio; unit = 'mg/day PO';
    } else if (drugKey === 'fentanyl' && route === 'TD') {
      dose = adjMME / getFactor('fentanyl', 'TD'); unit = 'mcg/hr patch';
    } else if (drugKey === 'fentanyl' && route === 'IV') {
      dose = adjMME / getFactor('fentanyl', 'IV'); unit = 'mcg/day IV';
    } else {
      const f = getFactor(drugKey, route);
      if (typeof f === 'number') { dose = adjMME / f; unit = `mg/day ${route}`; }
    }
    if (dose != null) {
      lines.push('');
      lines.push(`Target conversion: ${DRUGS[drugKey].label} ${route}`);
      lines.push(`  Cross-tolerance reduction: ${(reduction * 100).toFixed(0)}% (${formatNum(totalMME)} → ${formatNum(adjMME)} MME)`);
      lines.push(`  Equivalent dose: ${formatNum(dose)} ${unit}`);
      const orders = buildConversionOrders(drugKey, route, dose, adjMME);
      if (orders) {
        lines.push('');
        lines.push('Suggested orders:');
        orders.scheduled.forEach((s, i) => lines.push(`  ${i === 0 ? 'Scheduled:' : '  or'}     ${s}`));
        lines.push(`  Breakthrough: ${orders.breakthrough}`);
        orders.notes.forEach(n => lines.push(`  Note: ${n}`));
      }
    }
  }

  const alerts = buildSafetyAlerts(totalMME);
  if (alerts.length) {
    lines.push('');
    lines.push('Safety considerations:');
    alerts.forEach(a => lines.push(`  • ${a.title} — ${a.body} [${a.cite}]`));
  }

  lines.push('');
  lines.push(`Calculated with the MME Calculator using the ${getActiveTable().label} equianalgesic table.`);
  lines.push('Not a substitute for clinical judgement.');
  return lines.join('\n');
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (e) { return false; }
}

function flashButton(btn, ok) {
  const prev = btn.textContent;
  btn.textContent = ok ? 'Copied!' : 'Copy failed';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
}

export function wireExport() {
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const copyNoteBtn = document.getElementById('copy-note-btn');
  const printBtn = document.getElementById('print-btn');
  if (copyUrlBtn) copyUrlBtn.addEventListener('click', async () => {
    syncHash();
    const url = location.href;
    const ok = await copyToClipboard(url);
    flashButton(copyUrlBtn, ok);
  });
  if (copyNoteBtn) copyNoteBtn.addEventListener('click', async () => {
    const rows = getRowsForActiveView();
    const total = rows.reduce((s, r) => s + (r.mme || 0), 0);
    const note = buildClinicalNote(rows, total);
    const ok = await copyToClipboard(note);
    flashButton(copyNoteBtn, ok);
  });
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}
