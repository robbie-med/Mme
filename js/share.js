// URL hash sync, copy-as-URL, copy-as-EHR-note, print, clipboard helper.
import { DRUGS, ROUTE_LABELS } from './drugs.js';
import {
  DEFAULT_TABLE, getActiveTable, hasFactor, resolveTableKey,
} from './tables.js';
import { settings } from './settings.js';
import { ledger, addManualEntry } from './ledger.js';
import { formatNum } from './mme.js';
import { view, VIEWS } from './views.js';
import { computeConversion } from './conversion.js';
import { getRiskTier, buildSafetyAlerts } from './safety.js';
import { getRowsForActiveView, getWindowSettings } from './render.js';

let suppressHashSync = false;

// Shared links encode each entry as the daily dose the calculator is using
// right now (same window/anchor as the screen), so the link reproduces the
// displayed MME. Standing entries keep their per-dose × doses/day form.
function entryShareDose(entry, row) {
  if (entry.source === 'manual' && !entry._timesSet && entry._dose != null) {
    return { dose: entry._dose, perDay: entry._perDay || 1 };
  }
  return { dose: row ? row.normalizedDaily : 0, perDay: 1 };
}

export function buildShareHash() {
  let rows = [];
  try { rows = getRowsForActiveView(); } catch (e) { rows = []; }
  const items = ledger.map((e, i) => {
    const { dose, perDay } = entryShareDose(e, rows[i]);
    if (!(dose > 0)) return '';
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
  // Table first, so the entries below are validated against it.
  const tbl = params.get('tbl');
  if (tbl) settings.activeTable = resolveTableKey(tbl);
  if (m) {
    suppressHashSync = true;
    ledger.length = 0;
    m.split(';').forEach(item => {
      const [drug, route, doseStr, perDayStr] = item.split('|');
      const dose = parseFloat(doseStr);
      const perDay = parseFloat(perDayStr) || 1;
      if (!DRUGS[drug] || !isFinite(dose) || dose <= 0) return;
      if (!hasFactor(drug, route)) return;
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
  return loaded;
}

function buildClinicalNote(rows, totalMME) {
  const lines = [];
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  const table = getActiveTable();
  lines.push(`MME Calculator · ${stamp}`);
  const { windowHours } = getWindowSettings();
  lines.push(`Factor table: ${table.label}. Window: ${windowHours === 'all' ? 'all charted doses' : `last ${windowHours} h`}, normalized to 24 h; typed-in regimens count as daily.`);
  lines.push('');
  lines.push('Current regimen:');
  if (!rows.length) lines.push('  (none)');
  else rows.forEach(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    const route = ROUTE_LABELS[e.route] || e.route;
    const mme = r.mme == null ? '—' : formatNum(r.mme);
    lines.push(`  • ${drug} ${route} · ${e.label || ''} → ${mme} MME/day`);
    lines.push(`      ${r.factorDescription}`);
  });
  lines.push('');
  const tier = getRiskTier(totalMME);
  const tierLabel = tier.label + (totalMME > 0 ? ` (${tier.explain})` : '');
  lines.push(`Total: ${formatNum(totalMME)} MME / day  [${tierLabel}]`);

  const targetSel = document.getElementById('target-drug');
  const reductionSel = document.getElementById('reduction');
  if (targetSel && targetSel.value && totalMME > 0) {
    const conv = computeConversion(rows, targetSel.value, Number(reductionSel.value));
    if (conv && !conv.error) {
      lines.push('');
      lines.push(`Target conversion: ${conv.label} ${conv.route}`);
      conv.steps.forEach(s => lines.push(`  ${s.k}: ${s.v}`));
      if (conv.calculatedDaily != null) lines.push(`  Calculated equivalent: ${formatNum(conv.calculatedDaily)} ${conv.unitDaily}`);
      conv.warnings.forEach(w => lines.push(`  WARNING: ${w}`));
      if (conv.blocked) {
        lines.push(`  NOT GENERATED: ${conv.blocked}`);
      } else if (conv.orders) {
        lines.push('');
        lines.push('Suggested orders:');
        conv.orders.warnings.forEach(w => lines.push(`  WARNING: ${w}`));
        conv.orders.scheduled.forEach((s, i) => lines.push(`  ${i === 0 ? 'Scheduled:' : '  or'}     ${s}`));
        lines.push(`  Breakthrough: ${conv.orders.breakthrough}`);
        if (conv.projectedMME != null) lines.push(`  Projected scheduled total: ${formatNum(conv.projectedMME)} MME/day`);
        conv.orders.notes.forEach(n => lines.push(`  Note: ${n}`));
      }
      conv.notes.forEach(n => lines.push(`  Note: ${n}`));
    }
  }

  const alerts = buildSafetyAlerts(totalMME);
  if (alerts.length) {
    lines.push('');
    lines.push('Safety considerations:');
    alerts.forEach(a => lines.push(`  • ${a.title}: ${a.body} [${a.cite}]`));
  }

  lines.push('');
  lines.push(`Source: ${table.cite}`);
  lines.push('Equianalgesic ratios are population estimates. Not a substitute for clinical judgement.');
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
