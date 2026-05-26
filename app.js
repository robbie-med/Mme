'use strict';

/* ------------------------------------------------------------------ *
 * Drug catalog (labels only).
 * Conversion factors live in the TABLES registry below so the active
 * equianalgesic table (CDC 2022 / GlobalRPh / ASCO+Practical) governs
 * every MME calculation. The drug roster is identical across tables;
 * only factor values and methadone tiers differ.
 * ------------------------------------------------------------------ */

const DRUGS = {
  morphine:      { label: 'Morphine' },
  hydromorphone: { label: 'Hydromorphone' },
  oxycodone:     { label: 'Oxycodone' },
  oxymorphone:   { label: 'Oxymorphone' },
  hydrocodone:   { label: 'Hydrocodone' },
  codeine:       { label: 'Codeine' },
  tramadol:      { label: 'Tramadol' },
  tapentadol:    { label: 'Tapentadol' },
  meperidine:    { label: 'Meperidine' },
  fentanyl:      { label: 'Fentanyl' },
  methadone:     { label: 'Methadone' },
  levorphanol:   { label: 'Levorphanol' },
  buprenorphine: { label: 'Buprenorphine' },
  nalbuphine:    { label: 'Nalbuphine' },
  butorphanol:   { label: 'Butorphanol' },
};

/* ------------------------------------------------------------------ *
 * Equianalgesic table registry. Each table is self-contained:
 *   - factors:        { drug -> { route -> MME per mg/mcg/mcg-hr-day } }
 *                     Methadone PO carries the sentinel 'tiered' because
 *                     its factor depends on total daily dose.
 *   - methadoneIn:    daily methadone mg -> MME factor (inbound)
 *   - methadoneOut:   total MME -> morphine:methadone ratio (outbound)
 *   - label, cite:    human-readable identity for citations.
 * ------------------------------------------------------------------ */

const BASE_FACTORS = {
  morphine:      { PO: 1,     IV: 3,    IM: 3,    SC: 3 },
  hydromorphone: { PO: 4,     IV: 20,   IM: 20,   SC: 20 },
  oxycodone:     { PO: 1.5 },
  oxymorphone:   { PO: 3,     IV: 30,   IM: 30,   SC: 30 },
  hydrocodone:   { PO: 1 },
  codeine:       { PO: 0.15,  IV: 0.25, IM: 0.25, SC: 0.25 },
  tramadol:      { PO: 0.1 },
  tapentadol:    { PO: 0.4 },
  meperidine:    { PO: 0.1,   IV: 0.4,  IM: 0.4,  SC: 0.4 },
  fentanyl:      { IV: 0.3,   IM: 0.3,  SC: 0.3,  TD: 2.4 },
  methadone:     { PO: 'tiered', IV: 6 },
  levorphanol:   { PO: 11 },
  buprenorphine: {},
  nalbuphine:    { IV: 3, IM: 3, SC: 3 },
  butorphanol:   { IV: 15, IM: 15 },
};

const TABLES = {
  cdc: {
    label: 'CDC 2022',
    cite:  'CDC 2022 Clinical Practice Guideline for Prescribing Opioids; oral morphine = 1 MME baseline.',
    factors: BASE_FACTORS,
    methadoneIn(dailyMg) {
      if (dailyMg <= 20) return 4;
      if (dailyMg <= 40) return 8;
      if (dailyMg <= 60) return 10;
      return 12;
    },
    methadoneOut(mme) {
      if (mme <= 80)   return 4;
      if (mme <= 320)  return 8;
      if (mme <= 600)  return 10;
      return 12;
    },
  },
  globalrph: {
    label: 'GlobalRPh',
    cite:  'GlobalRPh equianalgesic table; oral morphine 30 mg / IV morphine 10 mg chronic baseline.',
    factors: BASE_FACTORS,
    methadoneIn(_dailyMg) { return 7; },
    methadoneOut(mme) {
      if (mme <= 99)   return 4;
      if (mme <= 299)  return 8;
      if (mme <= 499)  return 12;
      if (mme <= 999)  return 15;
      if (mme <= 1999) return 20;
      return 30;
    },
  },
  asco: {
    label: 'ASCO / Practical',
    cite:  'ASCO Adult Cancer Pain Guideline; Mercadante 2001; Practical Pain Management (Fudin).',
    factors: Object.assign({}, BASE_FACTORS, {
      hydromorphone: { PO: 5, IV: 25, IM: 25, SC: 25 },
    }),
    methadoneIn(dailyMg) {
      if (dailyMg <= 30) return 4;
      if (dailyMg <= 90) return 8;
      return 12;
    },
    methadoneOut(mme) {
      if (mme <= 90)  return 4;
      if (mme <= 300) return 8;
      return 12;
    },
  },
};

const DEFAULT_TABLE = 'cdc';

function getActiveTable() {
  return TABLES[settings.activeTable] || TABLES[DEFAULT_TABLE];
}
function getFactor(drug, route) {
  const f = getActiveTable().factors[drug];
  return f ? f[route] : undefined;
}
function getRoutesForDrug(drug) {
  return Object.keys(getActiveTable().factors[drug] || {});
}
function methadoneInFactor(dailyMg)   { return getActiveTable().methadoneIn(dailyMg); }
function methadoneOutFactor(mmeTotal) { return getActiveTable().methadoneOut(mmeTotal); }

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
      const tdFactor = getFactor('fentanyl', 'TD');
      mme = rate * tdFactor;
      factorDescription = `${rate} mcg/hr × ${tdFactor} MME per mcg/hr-day`;
    }
  } else if (entry.drug === 'methadone' && entry.route === 'PO') {
    const factor = methadoneInFactor(normalizedDaily);
    mme = normalizedDaily * factor;
    factorDescription = `${formatNum(normalizedDaily)} mg/day × ${factor} (${getActiveTable().label} methadone tier)`;
  } else {
    const factor = getFactor(entry.drug, entry.route);
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
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  let s = n.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
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
const CONTEXT_KEY  = 'mme.context.v1';

const settings = {
  defaultView: 'simple',
  persist: true,
  activeTable: DEFAULT_TABLE,
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

// Patient context — never affects MME math, only which alerts fire.
const patientContext = {
  age: 'unspecified',
  renal: 'unspecified',
  hepatic: 'unspecified',
};

function saveContext() {
  try {
    if (settings.persist) localStorage.setItem(CONTEXT_KEY, JSON.stringify(patientContext));
    else localStorage.removeItem(CONTEXT_KEY);
  } catch (e) {}
}
function loadContext() {
  if (!settings.persist) return;
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c && typeof c === 'object') Object.assign(patientContext, c);
  } catch (e) {}
}
function isContextActive() {
  return patientContext.age !== 'unspecified'
      || patientContext.renal !== 'unspecified'
      || patientContext.hepatic !== 'unspecified';
}
function clearPatientContext() {
  patientContext.age = 'unspecified';
  patientContext.renal = 'unspecified';
  patientContext.hepatic = 'unspecified';
}

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
  // Track _dose / _perDay so the entry round-trips through the URL hash and
  // share-as-note exports cleanly without re-deriving from admins.
  ledger.push({ id: nextId++, source: 'manual', drug, route, label, strengthUnit: u, admins, _dose: dose, _perDay: perDay });
  saveLedger();
  syncHash();
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
  syncHash();
}

function removeEntry(id) {
  const i = ledger.findIndex(e => e.id === id);
  if (i >= 0) ledger.splice(i, 1);
  saveLedger();
  syncHash();
  render();
}
function clearAll() {
  if (ledger.length > 0 && !confirm('Remove all medications from the list?')) return;
  ledger.length = 0;
  saveLedger();
  syncHash();
  render();
}

/* ------------------------------------------------------------------ *
 * URL-hash share / restore
 *
 * The hash encodes a regimen as
 *   #m=drug|route|dose|perDay;drug|route|dose|perDay&t=drug|route&rx=25
 * Parsed entries with timestamp data are collapsed to "manual-style"
 * (drug/route + daily dose, perDay=1) when serialized so the URL stays
 * short enough to share.
 * ------------------------------------------------------------------ */

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
  // Fentanyl TD: dose is mcg/hr (latest); treat as a single rate.
  if (entry.drug === 'fentanyl' && entry.route === 'TD') {
    const latest = all.kept.reduce((a, b) => a.ts > b.ts ? a : b);
    return { dose: latest.dose, perDay: 1 };
  }
  return { dose: total, perDay: 1 };
}

function buildShareHash() {
  const items = ledger.map(e => {
    const { dose, perDay } = entryDailyDose(e);
    return [e.drug, e.route, +dose.toFixed(4), +perDay.toFixed(4)].join('|');
  }).filter(s => s);
  const target = (document.getElementById('target-drug') || {}).value || '';
  const rx = (document.getElementById('reduction') || {}).value || '';
  const view = currentView;
  const parts = [];
  if (items.length) parts.push('m=' + items.join(';'));
  if (target) parts.push('t=' + target);
  if (rx) parts.push('rx=' + rx);
  if (view && view !== settings.defaultView) parts.push('v=' + view);
  // Only carry table key when it differs from the default to keep URLs short.
  if (settings.activeTable && settings.activeTable !== DEFAULT_TABLE) {
    parts.push('tbl=' + settings.activeTable);
  }
  return parts.join('&');
}

function syncHash() {
  if (suppressHashSync) return;
  const newHash = buildShareHash();
  const want = newHash ? '#' + newHash : '';
  if (location.hash === want) return;
  try { history.replaceState(null, '', want || location.pathname + location.search); }
  catch (e) { location.hash = newHash; }
}

function loadFromHash() {
  if (!location.hash || location.hash.length < 2) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const m = params.get('m');
  let loaded = false;
  if (m) {
    suppressHashSync = true;
    // Replace ledger contents.
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
  if (v && VIEWS.includes(v)) currentView = v;
  const tbl = params.get('tbl');
  if (tbl && TABLES[tbl]) settings.activeTable = tbl;
  return loaded;
}

/* ------------------------------------------------------------------ *
 * Export / share UI
 * ------------------------------------------------------------------ */

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

  // Conversion section if a target is selected
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
  // Fallback
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

function wireExport() {
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
 * Rendering — derivation expansion state
 * ------------------------------------------------------------------ */

const expandedRows = new Set();
let totalExpanded = false;

function wireRowExpansion(wrap) {
  wrap.querySelectorAll('[data-expand]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = Number(btn.dataset.expand);
      if (expandedRows.has(id)) expandedRows.delete(id); else expandedRows.add(id);
      render();
    });
  });
}

function citationFor(entry) {
  const t = getActiveTable();
  const tablePart = `${t.label}: ${t.cite}`;
  if (entry.drug === 'methadone' && entry.route === 'PO')
    return `${tablePart} Methadone PI; Fudin et al.`;
  if (entry.drug === 'fentanyl' && entry.route === 'TD')
    return `${tablePart} Duragesic PI; Donner et al. Pain 1996 (25 mcg/hr ≈ 60 MME).`;
  if (entry.drug === 'fentanyl')
    return `${tablePart} Fentanyl IV 100 mcg ≈ morphine IV 10 mg ≈ morphine PO 30 mg (chronic).`;
  return tablePart;
}

function buildDerivation(r) {
  const e = r.entry;
  const drugLabel = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
  const u = drugUnit(e.drug);
  const parts = [];

  parts.push(`<div class="d-step"><span class="d-label">Medication</span><span class="d-value">${escapeHtml(drugLabel)} ${escapeHtml(ROUTE_LABELS[e.route] || e.route)} <span class="source-tag ${e.source}">${e.source}</span></span></div>`);

  if (e.source === 'manual') {
    parts.push(`<div class="d-step"><span class="d-label">Entered as</span><span class="d-value">${escapeHtml(e.label || '')}</span></div>`);
  } else if (r.kept.length > 0) {
    const adminLines = r.kept.slice(0, 30).map(a =>
      `<div>${formatDate(a.ts)} &middot; ${formatNum(a.dose)} ${a.unit}</div>`).join('');
    parts.push(`<div class="d-step"><span class="d-label">Doses in window</span><span class="d-value">${r.kept.length} dose${r.kept.length===1?'':'s'} · sum ${formatNum(r.totalDose)} ${u}<div class="d-admins">${adminLines}${r.kept.length>30?'<div>…</div>':''}</div></span></div>`);
  } else {
    parts.push(`<div class="d-step"><span class="d-label">Doses in window</span><span class="d-value">0 — entry contributes 0 MME for this window</span></div>`);
  }

  if (r.spanHours != null && r.spanHours > 24 && r.normalizedDaily !== r.totalDose) {
    parts.push(`<div class="d-step"><span class="d-label">Normalized</span><span class="d-value">${formatNum(r.totalDose)} ${u} × 24 / ${r.spanHours.toFixed(1)} h = <strong>${formatNum(r.normalizedDaily)} ${u}/day</strong></span></div>`);
  } else if (r.kept.length > 0 && !(e.drug === 'fentanyl' && e.route === 'TD')) {
    parts.push(`<div class="d-step"><span class="d-label">Daily dose</span><span class="d-value"><strong>${formatNum(r.normalizedDaily)} ${u}/day</strong></span></div>`);
  }

  parts.push(`<div class="d-step"><span class="d-label">Calculation</span><span class="d-value">${escapeHtml(r.factorDescription || '—')}</span></div>`);

  parts.push(`<div class="d-step d-result"><span class="d-label">MME / day</span><span class="d-value"><strong>${r.mme == null ? '—' : formatNum(r.mme)}</strong></span></div>`);

  parts.push(`<div class="d-cite">${citationFor(e)}</div>`);
  return parts.join('');
}

function buildTotalDerivation(rows, totalMME) {
  if (!rows.length) return '<p class="hint">No medications to summarize.</p>';
  const u = (k) => drugUnit(k);
  const lines = rows.map(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    return `<div class="t-line">
      <span class="t-name">${escapeHtml(drug)} ${escapeHtml(e.route)}</span>
      <span class="t-detail">${escapeHtml(r.factorDescription || '—')}</span>
      <span class="t-mme">${r.mme == null ? '—' : formatNum(r.mme)} MME</span>
    </div>`;
  }).join('');
  return `
    <div class="t-derivation">
      ${lines}
      <div class="t-line t-sum">
        <span class="t-name">Total</span>
        <span class="t-detail"></span>
        <span class="t-mme">${formatNum(totalMME)} MME / day</span>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Rendering — main
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
  renderSafety(totalMME);
  renderConversion(totalMME);
}

function getRiskTier(mme) {
  if (mme >= 90) return { level: 'high',    label: 'High risk',       explain: '≥90 MME/day' };
  if (mme >= 50) return { level: 'caution', label: 'Caution',         explain: '≥50 MME/day' };
  return                { level: 'low',     label: 'Below threshold', explain: '<50 MME/day' };
}

function addPatientContextAlerts(alerts, totalMME) {
  const elderly = patientContext.age === '65-74' || patientContext.age === '75plus';
  const veryElderly = patientContext.age === '75plus';
  const renalImpaired = ['moderate', 'severe', 'dialysis'].includes(patientContext.renal);
  const renalSevere   = ['severe', 'dialysis'].includes(patientContext.renal);
  const hepaticImpaired = ['moderate', 'severe'].includes(patientContext.hepatic);
  const hepaticSevere   = patientContext.hepatic === 'severe';
  const has = (k) => ledger.some(e => e.drug === k);

  if (elderly && totalMME > 0) {
    alerts.push({
      severity: veryElderly ? 'severe' : 'normal',
      title: `Older adult${veryElderly ? ' (≥75)' : ' (65–74)'} — start low, go slow`,
      body: 'Older adults are more susceptible to opioid-induced sedation, confusion, constipation, and falls. Reduce initial doses ~25–50%, titrate slowly, and reassess function and cognition each visit.',
      cite: 'AGS Beers Criteria; CDC 2022.',
    });
  }
  if (elderly && has('meperidine')) {
    alerts.push({
      severity: 'severe',
      title: 'Older adult + meperidine — Beers Criteria avoid',
      body: 'AGS Beers Criteria specifically recommend against meperidine in older adults due to neurotoxicity risk from normeperidine accumulation. Choose an alternative opioid.',
      cite: 'AGS Beers Criteria 2023.',
    });
  }

  if (renalImpaired) {
    if (has('meperidine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + meperidine — avoid',
        body: 'Normeperidine clearance is renal. Accumulation in CKD or dialysis causes CNS toxicity (myoclonus, seizures). Avoid in this patient.',
        cite: 'KDIGO; Meperidine PI.',
      });
    }
    if (has('morphine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + morphine — accumulation risk',
        body: 'M3G/M6G metabolites accumulate with reduced renal clearance and cause prolonged sedation and respiratory depression. Consider hydromorphone, fentanyl, methadone, or buprenorphine as renal-friendlier alternatives.',
        cite: 'KDIGO; UpToDate.',
      });
    }
    if (has('codeine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + codeine — avoid',
        body: 'Codeine and its active metabolite morphine + M6G accumulate with reduced renal clearance. Choose an alternative.',
        cite: 'KDIGO.',
      });
    }
    if (has('tramadol')) {
      alerts.push({
        severity: 'normal',
        title: 'Renal impairment + tramadol — reduce dose',
        body: 'In CrCl <30 mL/min, max 200 mg/day; active metabolite accumulates. Consider 50% dose reduction and extending interval to q12h.',
        cite: 'Tramadol PI.',
      });
    }
  }
  if (renalSevere && has('hydromorphone')) {
    alerts.push({
      severity: 'normal',
      title: 'Severe renal impairment + hydromorphone — monitor',
      body: 'H3G metabolite accumulates but is less neurotoxic than morphine’s M3G. Hydromorphone is generally preferred over morphine in CKD; still reduce dose and extend interval.',
      cite: 'KDIGO.',
    });
  }

  if (hepaticImpaired && totalMME > 0) {
    alerts.push({
      severity: hepaticSevere ? 'severe' : 'normal',
      title: 'Hepatic impairment — reduce dose, prolonged half-life',
      body: 'Most opioids undergo hepatic metabolism. Moderate–severe impairment prolongs half-life and elevates plasma levels. Reduce initial doses (often ~50%) and extend dosing intervals.',
      cite: 'Drug-specific PIs.',
    });
  }
  if (hepaticSevere) {
    const hepAvoid = ['tramadol', 'tapentadol', 'meperidine'].filter(has);
    if (hepAvoid.length) {
      alerts.push({
        severity: 'severe',
        title: `Severe hepatic + ${hepAvoid.join(' / ')} — avoid`,
        body: 'These agents are contraindicated or strongly discouraged in severe hepatic impairment due to unpredictable kinetics (tramadol/tapentadol) or active-metabolite accumulation (meperidine).',
        cite: 'Tramadol/Tapentadol/Meperidine PIs.',
      });
    }
  }
}

function buildSafetyAlerts(totalMME) {
  const alerts = [];
  if (totalMME >= 50) {
    alerts.push({
      severity: totalMME >= 90 ? 'severe' : 'normal',
      title: 'Consider co-prescribing naloxone',
      body: 'CDC and most pain guidelines recommend offering naloxone to patients on ≥50 MME/day, or with concurrent benzodiazepines, sleep apnea, prior overdose, or substance-use disorder. Counsel the patient and a household contact on use.',
      cite: 'CDC 2022 Clinical Practice Guideline for Prescribing Opioids',
    });
  }
  if (totalMME >= 90) {
    alerts.push({
      severity: 'severe',
      title: 'High-risk dosing — careful review recommended',
      body: 'Doses ≥90 MME/day carry meaningfully higher overdose risk. Reassess goals of pain therapy, check the PMP/PDMP, screen for concurrent sedatives, and consider tapering, adjunctive non-opioid therapies, or specialist input.',
      cite: 'CDC 2022; SAMHSA',
    });
  }
  if (ledger.some(e => e.drug === 'methadone')) {
    alerts.push({
      severity: 'severe',
      title: 'Methadone-specific cautions',
      body: 'Long, highly variable half-life (8–60 h) → delayed steady state (5–7 days) and accumulation risk. Obtain baseline and periodic ECG to monitor QTc; avoid concurrent QT-prolonging drugs. Equianalgesic conversions are non-linear; involve a pain or palliative specialist for opioid-tolerant conversions.',
      cite: 'Methadone PI; CDC; Fudin et al.',
    });
  }
  if (ledger.some(e => e.drug === 'meperidine')) {
    alerts.push({
      severity: 'severe',
      title: 'Meperidine — generally avoid',
      body: 'The metabolite normeperidine accumulates with prolonged use or renal impairment and causes CNS toxicity (tremor, myoclonus, seizures). Most pain guidelines and the AGS Beers Criteria recommend against meperidine for routine analgesia, especially in older adults. Choose an alternative opioid.',
      cite: 'AGS Beers Criteria; ASPMN; APS',
    });
  }
  if (ledger.some(e => e.drug === 'tramadol')) {
    alerts.push({
      severity: 'normal',
      title: 'Tramadol — interaction & seizure cautions',
      body: 'Lowers seizure threshold and can precipitate serotonin syndrome with SSRIs/SNRIs/MAOIs/triptans/linezolid. Analgesic effect depends on CYP2D6 metabolism; ultra-rapid metabolizers and children are at higher risk for sedation/respiratory depression.',
      cite: 'Tramadol PI; FDA Drug Safety Communications',
    });
  }
  if (ledger.some(e => e.drug === 'codeine')) {
    alerts.push({
      severity: 'normal',
      title: 'Codeine — CYP2D6-dependent, avoid in children',
      body: 'Variable CYP2D6 conversion to morphine makes effect unpredictable; ultra-rapid metabolizers are at risk for opioid toxicity. Contraindicated post-tonsillectomy/adenoidectomy in children and in breastfeeding mothers.',
      cite: 'FDA Boxed Warning (2017)',
    });
  }
  if (ledger.some(e => e.drug === 'fentanyl' && e.route === 'TD')) {
    alerts.push({
      severity: 'normal',
      title: 'Fentanyl patch — opioid-naïve contraindication',
      body: 'Transdermal fentanyl is only for opioid-tolerant patients (≥60 mg/day oral morphine equivalent for ≥1 week). Heat (fever, heating pad, hot tub) increases absorption and overdose risk. Residual release continues 12–24 hours after patch removal.',
      cite: 'Duragesic PI',
    });
  }
  addPatientContextAlerts(alerts, totalMME);
  return alerts;
}

function renderSafety(totalMME) {
  const tier = getRiskTier(totalMME);
  const badge = document.getElementById('risk-badge');
  if (badge) {
    badge.className = 'risk-badge risk-' + tier.level;
    badge.textContent = totalMME > 0 ? `${tier.label} · ${tier.explain}` : tier.label;
  }
  const totalsCard = document.querySelector('.card.totals');
  if (totalsCard) {
    totalsCard.classList.remove('risk-low', 'risk-caution', 'risk-high');
    totalsCard.classList.add('risk-' + tier.level);
  }
  const el = document.getElementById('safety-alerts');
  if (!el) return;
  const alerts = totalMME > 0 || ledger.length > 0 ? buildSafetyAlerts(totalMME) : [];
  if (!alerts.length) { el.innerHTML = ''; return; }
  el.innerHTML = alerts.map(a => `
    <div class="safety-alert ${a.severity === 'severe' ? 'severe' : ''}">
      <h4>${escapeHtml(a.title)}</h4>
      <p>${escapeHtml(a.body)}</p>
      <div class="alert-cite">${escapeHtml(a.cite)}</div>
    </div>
  `).join('');
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
    const expanded = expandedRows.has(e.id);
    return `
      <div class="simple-med ${expanded ? 'expanded' : ''}" data-id="${e.id}">
        <div class="simple-med-row">
          <div class="simple-med-main">
            <div class="simple-med-name">${escapeHtml(drug)} <span class="tag ${routeClass}" style="font-size:11px">${escapeHtml(routeLabel)}</span></div>
            <div class="simple-med-sub">${escapeHtml(e.label || '')}</div>
          </div>
          <button class="simple-med-mme mme-clickable" data-expand="${e.id}" title="Show calculation">
            ${r.mme == null ? '—' : formatNum(r.mme)}<span class="simple-med-mme-unit">MME</span>
          </button>
          <button class="remove-btn" data-remove="${e.id}" title="Remove">×</button>
        </div>
        ${expanded ? `<div class="derivation-panel">${buildDerivation(r)}</div>` : ''}
      </div>`;
  }).join('');
  wireRowExpansion(wrap);
  wrap.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeEntry(Number(btn.dataset.remove)); }));
}

function renderComplexTable(rows) {
  const wrap = document.getElementById('meds-table-wrap');
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-state">No medications yet. Add one above, or paste an MAR.</p>';
    return;
  }
  const trs = [];
  rows.forEach(r => {
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
    trs.push(`<tr data-id="${e.id}">
      <td><div><strong>${escapeHtml(drug)}</strong> ${srcTag}</div>
        <div class="admin-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div></td>
      <td><span class="tag ${routeClass}">${e.route}</span></td>
      <td class="num">${r.kept.length}</td>
      <td class="num">${formatNum(r.totalDose)} ${u}</td>
      <td class="num">${formatNum(r.normalizedDaily)} ${u}</td>
      <td class="admin-detail" style="max-width:none">${escapeHtml(r.factorDescription)}</td>
      <td class="num mme"><button class="mme-clickable" data-expand="${e.id}" title="Show calculation">${r.mme == null ? '—' : formatNum(r.mme)}</button></td>
      <td><button class="remove-btn" data-remove="${e.id}" title="Remove">×</button></td>
    </tr>`);
    if (expandedRows.has(e.id)) {
      trs.push(`<tr class="meds-detail"><td colspan="8"><div class="derivation-panel">${buildDerivation(r)}</div></td></tr>`);
    }
  });
  wrap.innerHTML = `
    <table class="meds">
      <thead><tr>
        <th>Medication</th><th>Route</th>
        <th class="num">Doses (window)</th><th class="num">Total (window)</th>
        <th class="num">Normalized / day</th><th>Calc</th>
        <th class="num">MME / day</th><th></th>
      </tr></thead>
      <tbody>${trs.join('')}</tbody>
    </table>`;
  wireRowExpansion(wrap);
  wrap.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeEntry(Number(btn.dataset.remove)); }));
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
  const tableLabel = getActiveTable().label;
  document.getElementById('totals-detail').textContent =
    `Sum across ${drugCount} medication${drugCount === 1 ? '' : 's'} · window: ${windowLabel} · via ${tableLabel}`;

  // Click-to-expand on the total value
  const valWrap = document.getElementById('total-value-wrap');
  if (valWrap) {
    valWrap.classList.toggle('clickable', totalMME > 0);
    valWrap.onclick = totalMME > 0 ? () => { totalExpanded = !totalExpanded; render(); } : null;
  }
  // Maintain an expansion panel below totals
  let expEl = document.getElementById('total-derivation');
  if (!expEl) {
    expEl = document.createElement('div');
    expEl.id = 'total-derivation';
    expEl.className = 'total-derivation-panel';
    document.querySelector('.card.totals .big-number').appendChild(expEl);
  }
  if (totalExpanded && totalMME > 0) {
    expEl.hidden = false;
    expEl.innerHTML = buildTotalDerivation(rows, totalMME);
  } else {
    expEl.hidden = true;
    expEl.innerHTML = '';
  }
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
    const ratio = methadoneOutFactor(adjMME);
    dose = adjMME / ratio; unit = 'mg/day PO';
    calcDesc = `${formatNum(adjMME)} MME ÷ ${ratio} (${getActiveTable().label} methadone ratio)`;
  } else if (drugKey === 'fentanyl' && route === 'TD') {
    const tdF = getFactor('fentanyl', 'TD');
    dose = adjMME / tdF; unit = 'mcg/hr patch';
    calcDesc = `${formatNum(adjMME)} MME ÷ ${tdF} MME per mcg/hr-day`;
  } else if (drugKey === 'fentanyl' && route === 'IV') {
    const ivF = getFactor('fentanyl', 'IV');
    dose = adjMME / ivF; unit = 'mcg/day IV';
    calcDesc = `${formatNum(adjMME)} MME ÷ ${ivF} MME per mcg`;
  } else {
    const factor = getFactor(drugKey, route);
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
  const orders = buildConversionOrders(drugKey, route, dose, adjMME);
  el.classList.add('show');
  el.innerHTML = `<div>Equivalent dose of <strong>${escapeHtml(drugLabel)}</strong>:</div>
    <div class="target-dose">${formatNum(dose)} ${escapeHtml(unit)}</div>
    <div class="breakdown">${escapeHtml(calcDesc)}<br>${escapeHtml(reductionText)}</div>
    ${renderConversionOrders(orders)}`;
}

/* ------------------------------------------------------------------ *
 * Suggested-order generation
 * ------------------------------------------------------------------ */

function roundToStep(n, step) { return Math.round(n / step) * step; }

// Per-drug clinically reasonable rounding for a single dose.
function roundSingleDose(n, drugKey) {
  if (n < 0) return 0;
  if (drugKey === 'fentanyl') return Math.max(1, Math.round(n));
  if (drugKey === 'hydromorphone') return Math.max(0.5, roundToStep(n, 0.5));
  if (drugKey === 'oxymorphone')   return Math.max(2.5, roundToStep(n, 2.5));
  if (drugKey === 'oxycodone')     return Math.max(2.5, roundToStep(n, 2.5));
  if (drugKey === 'methadone')     return Math.max(2.5, roundToStep(n, 2.5));
  if (drugKey === 'tramadol')      return Math.max(25, roundToStep(n, 25));
  if (drugKey === 'tapentadol')    return Math.max(25, roundToStep(n, 25));
  if (drugKey === 'codeine')       return Math.max(15, roundToStep(n, 15));
  // morphine, hydrocodone default
  return Math.max(5, roundToStep(n, 5));
}

function unitFor(drugKey) { return drugKey === 'fentanyl' ? 'mcg' : 'mg'; }

const HAS_ER = new Set(['morphine', 'oxycodone', 'hydromorphone', 'oxymorphone', 'tramadol', 'tapentadol']);

function breakthroughLine(drugKey, route, dailyDose) {
  const u = unitFor(drugKey);
  const minD = roundSingleDose(dailyDose * 0.10, drugKey);
  const maxD = roundSingleDose(dailyDose * 0.20, drugKey);
  const label = DRUGS[drugKey].label;
  const form = route === 'PO' ? 'IR PO' : route;
  if (minD === maxD || minD === 0) return `~${maxD} ${u} ${label} ${form} q4h PRN (~15% of daily)`;
  return `${minD}–${maxD} ${u} ${label} ${form} q4h PRN (10–20% of daily)`;
}

function buildConversionOrders(drugKey, route, dose, adjMME) {
  const label = DRUGS[drugKey].label;
  const u = unitFor(drugKey);

  if (drugKey === 'methadone' && route === 'PO') {
    const per = roundSingleDose(dose / 3, drugKey);
    return {
      scheduled: [`${per} mg methadone PO TID (start low; titrate)`],
      breakthrough: 'Use a separate short-acting opioid for breakthrough — do not PRN methadone.',
      notes: [
        'Steady state takes 5–7 days; do not titrate faster than every ~5 days.',
        'Obtain baseline ECG; reassess QTc with dose changes or QT-prolonging drugs.',
        'Highly variable kinetics — pain or palliative specialist input strongly advised.',
      ],
    };
  }

  if (drugKey === 'fentanyl' && route === 'TD') {
    const patches = [12, 25, 37.5, 50, 62.5, 75, 87.5, 100];
    const conservative = patches.reduce((best, p) => p <= dose ? p : best, patches[0]);
    const btMg = roundSingleDose(adjMME * 0.15, 'morphine');
    return {
      scheduled: [`${conservative} mcg/hr patch q72h (rounded down for safety; available: 12, 25, 37.5, 50, 62.5, 75, 87.5, 100)`],
      breakthrough: `~${btMg} mg morphine IR PO q4h PRN (or any equivalent short-acting opioid)`,
      notes: [
        'Opioid-tolerant patients only (≥60 MME for ≥1 week).',
        'Onset 12–24 h after first patch — overlap with prior opioid initially.',
        'Heat (fever, hot tub, heating pad) increases absorption and overdose risk.',
      ],
    };
  }

  if (drugKey === 'fentanyl' && route === 'IV') {
    const rate = Math.max(5, roundToStep(dose / 24, 5));
    return {
      scheduled: [`Continuous infusion ~${rate} mcg/hr (titrate to effect)`],
      breakthrough: '25–50 mcg IV bolus q15min PRN, then adjust basal rate',
      notes: ['Use monitored setting; rapid bolus risks chest-wall rigidity at higher doses.'],
    };
  }

  if (route === 'PO') {
    const erDose = roundSingleDose(dose / 2, drugKey);
    const irDose = roundSingleDose(dose / 6, drugKey);
    const scheduled = [];
    if (HAS_ER.has(drugKey)) scheduled.push(`${erDose} ${u} ${label} ER PO BID`);
    scheduled.push(`${irDose} ${u} ${label} IR PO q4h scheduled (6 doses/day)`);
    return {
      scheduled,
      breakthrough: breakthroughLine(drugKey, 'PO', dose),
      notes: [],
    };
  }

  // Parenteral (IV/IM/SC)
  const perDose = roundSingleDose(dose / 6, drugKey);
  return {
    scheduled: [`${perDose} ${u} ${label} ${route} q4h scheduled (or PCA basal/demand)`],
    breakthrough: breakthroughLine(drugKey, route, dose),
    notes: [],
  };
}

function renderConversionOrders(orders) {
  if (!orders) return '';
  return `
    <div class="conv-orders">
      <h4>Suggested orders</h4>
      <div class="conv-order-line">
        <span class="conv-label">Scheduled</span>
        <span class="conv-value">${orders.scheduled.map(s => escapeHtml(s)).join('<br><span class="conv-or">or </span>')}</span>
      </div>
      <div class="conv-order-line">
        <span class="conv-label">Breakthrough</span>
        <span class="conv-value">${escapeHtml(orders.breakthrough)}</span>
      </div>
      ${orders.notes.length ? `<div class="conv-notes">${orders.notes.map(n => `<div class="conv-note">${escapeHtml(n)}</div>`).join('')}</div>` : ''}
    </div>`;
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
  const routes = getRoutesForDrug(drug);
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
  const tableSel = document.getElementById('setting-table');
  if (tableSel) tableSel.value = TABLES[settings.activeTable] ? settings.activeTable : DEFAULT_TABLE;
  applyContextToUI();
}

function applyContextToUI() {
  const map = { age: 'ctx-age', renal: 'ctx-renal', hepatic: 'ctx-hepatic' };
  for (const key in map) {
    const el = document.getElementById(map[key]);
    if (el) el.value = patientContext[key];
  }
  const chip = document.getElementById('ctx-active-chip');
  if (chip) {
    if (isContextActive()) {
      const parts = [];
      if (patientContext.age !== 'unspecified')     parts.push(humanizeAge(patientContext.age));
      if (patientContext.renal !== 'unspecified')   parts.push('renal: ' + patientContext.renal);
      if (patientContext.hepatic !== 'unspecified') parts.push('hepatic: ' + patientContext.hepatic);
      chip.hidden = false;
      chip.textContent = 'Active · ' + parts.join(' · ');
    } else {
      chip.hidden = true;
      chip.textContent = '';
    }
  }
}

function humanizeAge(a) {
  return ({ 'under65': '<65', '65-74': '65–74', '75plus': '≥75' })[a] || a;
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
    ledger.length = 0;
    nextId = 1;
    clearPatientContext();
    applySettingsToUI();
    setView('simple');
  });
}

function wirePatientContext() {
  const map = { age: 'ctx-age', renal: 'ctx-renal', hepatic: 'ctx-hepatic' };
  for (const key in map) {
    const el = document.getElementById(map[key]);
    if (!el) continue;
    el.addEventListener('change', e => {
      patientContext[key] = e.target.value;
      saveContext();
      applyContextToUI();
      render();
    });
  }
  const clearBtn = document.getElementById('ctx-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearPatientContext();
    saveContext();
    applyContextToUI();
    render();
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
  document.getElementById('target-drug').addEventListener('change', () => { syncHash(); render(); });
  document.getElementById('reduction').addEventListener('change', () => { syncHash(); render(); });

  // View tabs
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => { setView(btn.dataset.view); syncHash(); });
  });

  // Settings + patient context
  applySettingsToUI();
  wireSettings();
  wirePatientContext();
  wirePWA();
  wireExport();

  // URL hash takes priority over saved ledger / settings for the initial state
  // so a shared link reliably loads the regimen the recipient was sent.
  let initialView = settings.defaultView;
  const hashLoaded = loadFromHash();
  if (hashLoaded) initialView = currentView || initialView;
  // Re-sync UI controls after hash may have mutated settings (e.g. activeTable).
  applySettingsToUI();
  setView(initialView);

  // Restore final hash now that view is set (and selectors populated)
  syncHash();

  window.addEventListener('hashchange', () => {
    const ok = loadFromHash();
    if (ok) render();
  });
}

/* ------------------------------------------------------------------ *
 * PWA install + offline status
 * ------------------------------------------------------------------ */

function wirePWA() {
  // Install prompt (Chromium-family browsers fire beforeinstallprompt).
  let deferredPrompt = null;
  const installRow = document.getElementById('install-row');
  const installBtn = document.getElementById('install-btn');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (installRow) installRow.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      installBtn.disabled = true;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null;
      if (installRow) installRow.hidden = true;
    });
  }
  window.addEventListener('appinstalled', () => {
    if (installRow) installRow.hidden = true;
  });

  // Offline indicator in Settings.
  const offlineEl = document.getElementById('offline-status');
  function updateOfflineStatus() {
    if (!offlineEl) return;
    const swActive = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    const online = navigator.onLine;
    const parts = [];
    parts.push(online ? 'Online' : 'Offline');
    parts.push(swActive ? 'cached for offline use' : 'cache initializing (reload once)');
    offlineEl.textContent = parts.join(' · ');
  }
  updateOfflineStatus();
  window.addEventListener('online', updateOfflineStatus);
  window.addEventListener('offline', updateOfflineStatus);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(updateOfflineStatus).catch(() => {});
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
