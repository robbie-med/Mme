'use strict';

/* ------------------------------------------------------------------ *
 * Drug catalog — MME factor = mg oral morphine equivalent per 1 mg of
 * drug (per mcg for fentanyl IV; per mcg/hr-day for fentanyl TD).
 * Factors derived from the GlobalRPh equianalgesic table.
 * ------------------------------------------------------------------ */

const DRUGS = {
  morphine:      { label: 'Morphine',      factors: { PO: 1,     IV: 3,    IM: 3,    SC: 3 } },
  hydromorphone: { label: 'Hydromorphone', factors: { PO: 4,     IV: 20,   IM: 20,   SC: 20 } },
  oxycodone:     { label: 'Oxycodone',     factors: { PO: 1.5 } },
  oxymorphone:   { label: 'Oxymorphone',   factors: { PO: 3,     IV: 30,   IM: 30,   SC: 30 } },
  hydrocodone:   { label: 'Hydrocodone',   factors: { PO: 1 } },
  codeine:       { label: 'Codeine',       factors: { PO: 0.15,  IV: 0.25, IM: 0.25, SC: 0.25 } },
  tramadol:      { label: 'Tramadol',      factors: { PO: 0.1 } },
  tapentadol:    { label: 'Tapentadol',    factors: { PO: 0.4 } },
  meperidine:    { label: 'Meperidine',    factors: { PO: 0.1,   IV: 0.4,  IM: 0.4,  SC: 0.4 } },
  fentanyl:      { label: 'Fentanyl',      factors: { IV: 0.3,   IM: 0.3,  SC: 0.3,  TD: 2.4 } },
  methadone:     { label: 'Methadone',     factors: { PO: 'tiered', IV: 6 } },
  levorphanol:   { label: 'Levorphanol',   factors: { PO: 11 } },
  buprenorphine: { label: 'Buprenorphine', factors: {} },
  nalbuphine:    { label: 'Nalbuphine',    factors: { IV: 3, IM: 3, SC: 3 } },
  butorphanol:   { label: 'Butorphanol',   factors: { IV: 15, IM: 15 } },
};

const DRUG_ALIASES = {
  'ms contin': 'morphine', 'msir': 'morphine', 'roxanol': 'morphine', 'duramorph': 'morphine',
  'dilaudid': 'hydromorphone', 'exalgo': 'hydromorphone',
  'oxycontin': 'oxycodone', 'roxicodone': 'oxycodone', 'roxicet': 'oxycodone',
  'percocet': 'oxycodone', 'oxyir': 'oxycodone',
  'opana': 'oxymorphone',
  'norco': 'hydrocodone', 'vicodin': 'hydrocodone', 'lortab': 'hydrocodone',
  'lorcet': 'hydrocodone', 'hysingla': 'hydrocodone', 'zohydro': 'hydrocodone',
  'tylenol with codeine': 'codeine',
  'ultram': 'tramadol',
  'nucynta': 'tapentadol',
  'demerol': 'meperidine',
  'duragesic': 'fentanyl', 'sublimaze': 'fentanyl', 'actiq': 'fentanyl',
  'fentora': 'fentanyl', 'subsys': 'fentanyl',
  'methadose': 'methadone', 'dolophine': 'methadone',
  'levo-dromoran': 'levorphanol',
  'subutex': 'buprenorphine', 'suboxone': 'buprenorphine', 'butrans': 'buprenorphine',
  'nubain': 'nalbuphine',
  'stadol': 'butorphanol',
};

const ROUTE_LABELS = {
  PO: 'PO (oral)', IV: 'IV', IM: 'IM', SC: 'SC / SubQ', TD: 'Transdermal', SL: 'Sublingual',
};

function methadoneFactor(totalDailyMg) {
  if (totalDailyMg <= 20) return 4;
  if (totalDailyMg <= 40) return 8;
  if (totalDailyMg <= 60) return 10;
  return 12;
}
function methadoneTargetFactor(mmeTotal) {
  if (mmeTotal <= 99)   return 4;
  if (mmeTotal <= 299)  return 8;
  if (mmeTotal <= 499)  return 12;
  if (mmeTotal <= 999)  return 15;
  if (mmeTotal <= 1999) return 20;
  return 30;
}
function drugUnit(drugKey) { return drugKey === 'fentanyl' ? 'mcg' : 'mg'; }

/* ------------------------------------------------------------------ *
 * MAR paste parser
 * ------------------------------------------------------------------ */

const ROUTE_PATTERNS = [
  { rx: /\btransdermal\b|\bpatch\b|mcg\s*\/\s*hr/i, route: 'TD' },
  { rx: /\bIV\b|\bintraven/i,                       route: 'IV' },
  { rx: /\bIM\b|\bintramuscul/i,                    route: 'IM' },
  { rx: /\bSC\b|\bSUBQ\b|\bsubcut/i,                route: 'SC' },
  { rx: /\bsublingual\b|\bSL\b/i,                   route: 'SL' },
  { rx: /\bPO\b|\boral\b|\btab\b|\bcap(?:sule)?\b|\bsoln\b|\bsolution\b|\bsuspension\b|\belixir\b|\bliquid\b/i, route: 'PO' },
];
function detectRoute(line) { for (const p of ROUTE_PATTERNS) if (p.rx.test(line)) return p.route; return 'PO'; }

function matchDrugHeader(line) {
  const clean = line.replace(/^[\s••\-*]+/, '').trim();
  if (!clean || clean.length > 120) return null;
  const firstWord = clean.split(/[\s(,]/)[0].toLowerCase();
  if (DRUGS[firstWord]) return firstWord;
  const parenMatch = clean.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const parenWord = parenMatch[1].split(/[\s,]/)[0].toLowerCase();
    if (DRUGS[parenWord]) return parenWord;
    if (DRUG_ALIASES[parenWord]) return DRUG_ALIASES[parenWord];
  }
  if (DRUG_ALIASES[firstWord]) return DRUG_ALIASES[firstWord];
  const lower = clean.toLowerCase();
  for (const alias in DRUG_ALIASES) {
    if (alias.includes(' ') && lower.startsWith(alias)) return DRUG_ALIASES[alias];
  }
  return null;
}

function matchOrderLine(line) {
  const m = line.match(/^(?:or\s+)?([\d.]+)\s*(mg|mcg|g)\b(?:\s*\/\s*hr)?\s*[,;]/i);
  if (!m) return null;
  const isRate = /mcg\s*\/\s*hr/i.test(line) || /\bpatch\b/i.test(line);
  return { strength: parseFloat(m[1]), unit: m[2].toLowerCase(), route: isRate ? 'TD' : detectRoute(line), raw: line };
}
function matchDateLine(s) { return /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); }
function matchTimeLine(s) { return /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(s); }
function matchDoseLine(s) { return /^([\d.]+)\s*(mg|mcg|g)$/i.exec(s); }
function parseTimestamp(d, t) {
  const [mo, da, y] = d.split('/').map(Number);
  const yr = y < 100 ? 2000 + y : y;
  const [hh, mm] = t.split(':').map(Number);
  return new Date(yr, mo - 1, da, hh, mm).getTime();
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function parseMAR(text) {
  const warnings = [];
  const orders = [];
  if (!text || !text.trim()) return { orders, warnings };
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim());
  let currentDrug = null, currentOrder = null, i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i++; continue; }
    const drug = matchDrugHeader(line);
    if (drug && !/^[\d.]/.test(line)) { currentDrug = drug; currentOrder = null; i++; continue; }
    const order = matchOrderLine(line);
    if (order) {
      if (!currentDrug) { warnings.push('Order line without a recognized drug header: "' + truncate(line, 60) + '"'); i++; continue; }
      currentOrder = { drug: currentDrug, route: order.route, strength: order.strength, strengthUnit: order.unit, rawOrder: line, admins: [] };
      orders.push(currentOrder);
      i++; continue;
    }
    if (i + 2 < lines.length) {
      const dm = matchDateLine(lines[i]);
      const tm = dm && matchTimeLine(lines[i + 1]);
      const ddm = tm && matchDoseLine(lines[i + 2]);
      if (dm && tm && ddm) {
        if (!currentOrder) { warnings.push('Dose history without a preceding order — skipping.'); i += 3; continue; }
        currentOrder.admins.push({ date: lines[i], time: lines[i + 1], dose: parseFloat(ddm[1]), unit: ddm[2].toLowerCase(), ts: parseTimestamp(lines[i], lines[i + 1]) });
        i += 3; continue;
      }
    }
    i++;
  }
  const used = orders.filter(o => o.admins.length > 0);
  if (orders.length > used.length) warnings.push((orders.length - used.length) + ' order(s) had no recorded administrations and were omitted.');
  return { orders: used, warnings };
}

/* ------------------------------------------------------------------ *
 * MME calculation
 * ------------------------------------------------------------------ */

function filterAdminsByWindow(admins, windowHours, anchorTs) {
  if (admins.length === 0) return { kept: [], mode: 'window' };
  if (windowHours === 'all') return { kept: admins.slice(), mode: 'all' };
  const hrs = Number(windowHours);
  const start = anchorTs - hrs * 3600 * 1000;
  return { kept: admins.filter(a => a.ts >= start && a.ts <= anchorTs), mode: 'window' };
}

function computeEntryMME(entry, windowHours, anchorTs) {
  const drugInfo = DRUGS[entry.drug];
  const { kept, mode } = filterAdminsByWindow(entry.admins, windowHours, anchorTs);
  let totalDose = kept.reduce((s, a) => s + a.dose, 0);
  let unit = kept[0] ? kept[0].unit : entry.strengthUnit;
  if (unit === 'g') { totalDose *= 1000; unit = 'mg'; }
  let normalizedDaily = totalDose, spanHours = null;
  if (kept.length > 1) spanHours = (Math.max(...kept.map(a => a.ts)) - Math.min(...kept.map(a => a.ts))) / 3600000;
  if (mode === 'all' && spanHours && spanHours > 24) normalizedDaily = (totalDose * 24) / spanHours;
  let mme = 0, factorDescription = '';
  if (entry.drug === 'fentanyl' && entry.route === 'TD') {
    if (kept.length === 0) mme = 0;
    else {
      const latest = kept.reduce((a, b) => a.ts > b.ts ? a : b);
      const rate = latest.dose;
      mme = rate * DRUGS.fentanyl.factors.TD;
      factorDescription = `${rate} mcg/hr × 2.4 MME per mcg/hr-day`;
    }
  } else if (entry.drug === 'methadone' && entry.route === 'PO') {
    const factor = methadoneFactor(normalizedDaily);
    mme = normalizedDaily * factor;
    factorDescription = `${formatNum(normalizedDaily)} mg/day × ${factor} (tiered)`;
  } else {
    const factor = drugInfo && drugInfo.factors ? drugInfo.factors[entry.route] : null;
    if (factor == null || typeof factor !== 'number')
      return { entry, kept, totalDose, normalizedDaily, mme: null, factorDescription: 'No conversion factor available' };
    mme = normalizedDaily * factor;
    factorDescription = `${formatNum(normalizedDaily)} ${drugUnit(entry.drug)}/day × ${factor}`;
  }
  return { entry, kept, totalDose, normalizedDaily, mme, spanHours, factorDescription };
}

function formatNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n === 0) return '0';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10)  return n.toFixed(1);
  return n.toFixed(2).replace(/\.?0+$/, '');
}
function formatDate(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* ------------------------------------------------------------------ *
 * Settings + Ledger persistence
 * ------------------------------------------------------------------ */

const SETTINGS_KEY = 'mme.settings.v1';
const LEDGER_KEY   = 'mme.ledger.v1';

const settings = {
  defaultView: 'simple',
  persist: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') Object.assign(settings, s);
  } catch (e) { /* ignore corrupt storage */ }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

const ledger = [];
let nextId = 1;

function saveLedger() {
  try {
    if (settings.persist) localStorage.setItem(LEDGER_KEY, JSON.stringify({ ledger, nextId }));
    else localStorage.removeItem(LEDGER_KEY);
  } catch (e) {}
}
function loadLedger() {
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

/* ------------------------------------------------------------------ *
 * Ledger mutations
 * ------------------------------------------------------------------ */

function addManualEntry({ drug, route, dose, perDay }) {
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
  ledger.push({ id: nextId++, source: 'manual', drug, route, label, strengthUnit: u, admins });
  saveLedger();
}

function addParsedOrders(orders) {
  orders.forEach(o => {
    ledger.push({
      id: nextId++, source: 'parsed', drug: o.drug, route: o.route,
      label: `${formatNum(o.strength)} ${o.strengthUnit}${o.route !== 'TD' ? ` ${ROUTE_LABELS[o.route] || o.route}` : ' patch'} — ${o.admins.length} dose${o.admins.length === 1 ? '' : 's'} on file`,
      strengthUnit: o.strengthUnit, admins: o.admins,
    });
  });
  saveLedger();
}

function removeEntry(id) {
  const i = ledger.findIndex(e => e.id === id);
  if (i >= 0) ledger.splice(i, 1);
  saveLedger();
  render();
}
function clearAll() {
  if (ledger.length > 0 && !confirm('Remove all medications from the list?')) return;
  ledger.length = 0;
  saveLedger();
  render();
}

/* ------------------------------------------------------------------ *
 * View management
 * ------------------------------------------------------------------ */

const VIEWS = ['simple', 'complex', 'settings'];
let currentView = 'simple';

function setView(view) {
  if (!VIEWS.includes(view)) view = 'simple';
  currentView = view;
  document.body.classList.remove('view-simple', 'view-complex', 'view-settings');
  document.body.classList.add('view-' + view);
  document.querySelectorAll('.view-tab').forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  render();
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function getRowsForActiveView() {
  let windowHours = '24', anchorMode = 'latest';
  if (currentView === 'complex') {
    windowHours = document.getElementById('time-window').value;
    anchorMode = document.getElementById('window-anchor').value;
  }
  let anchorTs;
  if (anchorMode === 'now') {
    anchorTs = Date.now();
  } else {
    const allTs = ledger.flatMap(e => e.admins.map(a => a.ts));
    anchorTs = allTs.length ? Math.max(...allTs) : Date.now();
  }
  return ledger.map(e => computeEntryMME(e, windowHours, anchorTs));
}

function render() {
  const rows = getRowsForActiveView();
  const totalMME = rows.reduce((s, r) => s + (r.mme || 0), 0);
  if (currentView === 'simple') {
    renderSimpleList(rows);
  } else if (currentView === 'complex') {
    renderComplexTable(rows);
    renderWarnings(rows);
  }
  renderTotals(rows, totalMME);
  renderConversion(totalMME);
}

function renderSimpleList(rows) {
  const wrap = document.getElementById('simple-meds-list');
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-state">No medications yet. Add one above.</p>';
    return;
  }
  wrap.innerHTML = rows.map(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    const routeClass = ({PO:'po', IV:'iv', IM:'iv', SC:'iv', TD:'td'})[e.route] || '';
    const routeLabel = ROUTE_LABELS[e.route] || e.route;
    return `
      <div class="simple-med" data-id="${e.id}">
        <div class="simple-med-main">
          <div class="simple-med-name">${escapeHtml(drug)} <span class="tag ${routeClass}" style="font-size:11px">${escapeHtml(routeLabel)}</span></div>
          <div class="simple-med-sub">${escapeHtml(e.label || '')}</div>
        </div>
        <div class="simple-med-mme">${r.mme == null ? '—' : formatNum(r.mme)}<span class="simple-med-mme-unit">MME</span></div>
        <button class="remove-btn" data-remove="${e.id}" title="Remove">×</button>
      </div>`;
  }).join('');
  wrap.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => removeEntry(Number(btn.dataset.remove))));
}

function renderComplexTable(rows) {
  const wrap = document.getElementById('meds-table-wrap');
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-state">No medications yet. Add one above, or paste an MAR.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="meds">
      <thead><tr>
        <th>Medication</th><th>Route</th>
        <th class="num">Doses (window)</th><th class="num">Total (window)</th>
        <th class="num">Normalized / day</th><th>Calc</th>
        <th class="num">MME / day</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map(r => {
          const e = r.entry;
          const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
          const routeClass = ({PO:'po', IV:'iv', IM:'iv', SC:'iv', TD:'td'})[e.route] || '';
          const u = drugUnit(e.drug);
          const srcTag = `<span class="source-tag ${e.source}">${e.source}</span>`;
          let detail = e.label || '';
          if (e.source === 'parsed' && r.kept.length) {
            detail = r.kept.slice(0, 5).map(a => formatDate(a.ts) + ' · ' + formatNum(a.dose) + a.unit).join(' | ') +
              (r.kept.length > 5 ? ' …' : '');
          }
          return `<tr data-id="${e.id}">
            <td><div><strong>${escapeHtml(drug)}</strong> ${srcTag}</div>
              <div class="admin-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div></td>
            <td><span class="tag ${routeClass}">${e.route}</span></td>
            <td class="num">${r.kept.length}</td>
            <td class="num">${formatNum(r.totalDose)} ${u}</td>
            <td class="num">${formatNum(r.normalizedDaily)} ${u}</td>
            <td class="admin-detail" style="max-width:none">${escapeHtml(r.factorDescription)}</td>
            <td class="num mme">${r.mme == null ? '—' : formatNum(r.mme)}</td>
            <td><button class="remove-btn" data-remove="${e.id}" title="Remove">×</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => removeEntry(Number(btn.dataset.remove))));
}

function renderWarnings(rows) {
  const el = document.getElementById('warnings');
  if (!el) return;
  const items = [];
  rows.forEach(r => {
    if (r.mme == null) items.push(`No factor for ${DRUGS[r.entry.drug].label} (${r.entry.route}) — excluded from total.`);
    if (r.entry.drug === 'methadone' && r.kept.length > 0) items.push('Methadone conversions are highly variable. Confirm dose with a pain or palliative specialist.');
    if (r.entry.drug === 'fentanyl' && r.entry.route === 'TD' && r.entry.source === 'parsed')
      items.push('Fentanyl patch dose treated as continuous mcg/hr (latest value in window).');
  });
  if (!items.length) { el.innerHTML = ''; return; }
  const uniq = Array.from(new Set(items));
  el.innerHTML = '<div class="warning"><strong>Notes</strong><ul>' + uniq.map(t => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div>';
}

function renderTotals(rows, totalMME) {
  document.getElementById('total-mme').textContent = formatNum(totalMME);
  let windowLabel = 'last 24 h';
  if (currentView === 'complex') {
    const w = document.getElementById('time-window').value;
    windowLabel = w === 'all' ? 'all administrations (normalized to 24 h)' : `last ${w} h`;
  }
  const drugCount = rows.filter(r => r.mme && r.mme > 0).length;
  document.getElementById('totals-detail').textContent =
    `Sum across ${drugCount} medication${drugCount === 1 ? '' : 's'} · window: ${windowLabel}`;
}

function renderConversion(totalMME) {
  const el = document.getElementById('conversion-result');
  if (!totalMME || totalMME <= 0) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const target = document.getElementById('target-drug').value;
  if (!target) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const [drugKey, route] = target.split('|');
  const reduction = Number(document.getElementById('reduction').value) / 100;
  const adjMME = totalMME * (1 - reduction);
  let dose, unit, calcDesc;
  if (drugKey === 'methadone' && route === 'PO') {
    const ratio = methadoneTargetFactor(adjMME);
    dose = adjMME / ratio; unit = 'mg/day PO';
    calcDesc = `${formatNum(adjMME)} MME ÷ ${ratio} (tiered methadone ratio)`;
  } else if (drugKey === 'fentanyl' && route === 'TD') {
    dose = adjMME / DRUGS.fentanyl.factors.TD; unit = 'mcg/hr patch';
    calcDesc = `${formatNum(adjMME)} MME ÷ 2.4 MME per mcg/hr-day`;
  } else if (drugKey === 'fentanyl' && route === 'IV') {
    dose = adjMME / DRUGS.fentanyl.factors.IV; unit = 'mcg/day IV';
    calcDesc = `${formatNum(adjMME)} MME ÷ 0.3 MME per mcg`;
  } else {
    const factor = DRUGS[drugKey].factors[route];
    if (typeof factor !== 'number') {
      el.classList.add('show');
      el.innerHTML = '<strong>No conversion factor</strong> available for this target.';
      return;
    }
    dose = adjMME / factor; unit = `mg/day ${route}`;
    calcDesc = `${formatNum(adjMME)} MME ÷ ${factor}`;
  }
  const drugLabel = DRUGS[drugKey].label;
  const reductionText = reduction > 0
    ? `Applied ${(reduction * 100).toFixed(0)}% cross-tolerance reduction (${formatNum(totalMME)} → ${formatNum(adjMME)} MME).`
    : 'No cross-tolerance reduction applied.';
  el.classList.add('show');
  el.innerHTML = `<div>Equivalent dose of <strong>${escapeHtml(drugLabel)}</strong>:</div>
    <div class="target-dose">${formatNum(dose)} ${escapeHtml(unit)}</div>
    <div class="breakdown">${escapeHtml(calcDesc)}<br>${escapeHtml(reductionText)}</div>`;
}

/* ------------------------------------------------------------------ *
 * Quick-add form
 * ------------------------------------------------------------------ */

function populateDrugSelect() {
  document.getElementById('add-drug').innerHTML = Object.keys(DRUGS).map(k =>
    `<option value="${k}">${DRUGS[k].label}</option>`).join('');
}
function updateRouteOptions() {
  const drug = document.getElementById('add-drug').value;
  if (!DRUGS[drug]) return;
  const routes = Object.keys(DRUGS[drug].factors);
  const sel = document.getElementById('add-route');
  sel.innerHTML = routes.length
    ? routes.map(r => `<option value="${r}">${ROUTE_LABELS[r] || r}</option>`).join('')
    : `<option value="">(none available)</option>`;
}
function updateDoseLabels() {
  const drug = document.getElementById('add-drug').value;
  const route = document.getElementById('add-route').value;
  const doseLabel = document.getElementById('dose-label');
  const doseUnitHint = document.getElementById('dose-unit-hint');
  const freqField = document.getElementById('freq-field');
  const freqLabel = document.getElementById('freq-label');
  const freqInput = document.getElementById('add-freq');
  const help = document.getElementById('add-help');
  const u = drugUnit(drug);
  if (drug === 'fentanyl' && route === 'TD') {
    doseLabel.firstChild.textContent = 'Patch rate ';
    doseUnitHint.textContent = '(mcg/hr)';
    freqField.style.display = 'none'; freqInput.value = 1;
    help.textContent = 'Enter the patch strength (e.g. 25 for a 25 mcg/hr patch). Steady-state assumed.';
  } else if (drug === 'fentanyl' && route === 'IV') {
    doseLabel.firstChild.textContent = 'Dose per administration ';
    doseUnitHint.textContent = '(mcg)';
    freqField.style.display = ''; freqLabel.textContent = 'Doses per day';
    help.textContent = 'For a continuous infusion, enter mcg/hr in "Dose" and 24 in "Doses per day".';
  } else if (drug === 'methadone' && route === 'PO') {
    doseLabel.firstChild.textContent = 'Dose per administration ';
    doseUnitHint.textContent = '(mg)';
    freqField.style.display = ''; freqLabel.textContent = 'Doses per day';
    help.textContent = 'Chronic dosing assumed — tiered methadone factor applied to total daily mg.';
  } else {
    doseLabel.firstChild.textContent = 'Dose per administration ';
    doseUnitHint.textContent = `(${u})`;
    freqField.style.display = ''; freqLabel.textContent = 'Doses per day';
    help.textContent = '';
  }
}

function handleAdd() {
  const drug = document.getElementById('add-drug').value;
  const route = document.getElementById('add-route').value;
  const dose = parseFloat(document.getElementById('add-dose').value);
  const perDay = parseFloat(document.getElementById('add-freq').value) || 1;
  if (!isFinite(dose) || dose <= 0) { flashHelp('Enter a dose greater than 0.'); return; }
  if (!route) { flashHelp('Select a route.'); return; }
  addManualEntry({ drug, route, dose, perDay });
  document.getElementById('add-dose').value = '';
  document.getElementById('add-dose').focus();
  render();
}
function flashHelp(msg) {
  const el = document.getElementById('add-help');
  const prev = el.textContent;
  el.textContent = msg; el.style.color = '#b91c1c';
  setTimeout(() => { el.textContent = prev; el.style.color = ''; }, 2200);
}

/* ------------------------------------------------------------------ *
 * Settings UI
 * ------------------------------------------------------------------ */

function applySettingsToUI() {
  document.getElementById('setting-default-view').value = settings.defaultView;
  document.getElementById('setting-persist').checked = !!settings.persist;
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
  });
  document.getElementById('setting-reset').addEventListener('click', () => {
    if (!confirm('Reset settings and remove all saved medications? This cannot be undone.')) return;
    try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(LEDGER_KEY); } catch (e) {}
    settings.defaultView = 'simple';
    settings.persist = true;
    ledger.length = 0;
    nextId = 1;
    applySettingsToUI();
    setView('simple');
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function init() {
  loadSettings();
  loadLedger();

  // Drug + route selects
  populateDrugSelect();
  updateRouteOptions();
  updateDoseLabels();

  document.getElementById('add-drug').addEventListener('change', () => { updateRouteOptions(); updateDoseLabels(); });
  document.getElementById('add-route').addEventListener('change', updateDoseLabels);
  document.getElementById('add-btn').addEventListener('click', handleAdd);
  document.getElementById('add-dose').addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  document.getElementById('add-freq').addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });

  // Paste MAR
  document.getElementById('parse-btn').addEventListener('click', () => {
    const text = document.getElementById('input-text').value;
    const { orders, warnings } = parseMAR(text);
    if (!orders.length) { flashHelp(warnings.length ? warnings[0] : 'No medications detected in pasted text.'); return; }
    addParsedOrders(orders);
    render();
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
  document.getElementById('target-drug').addEventListener('change', render);
  document.getElementById('reduction').addEventListener('change', render);

  // View tabs
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Settings
  applySettingsToUI();
  wireSettings();

  // Initial view from settings
  setView(settings.defaultView);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
