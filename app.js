'use strict';

/* ------------------------------------------------------------------ *
 * Drug catalog
 *
 * MME factor = mg of oral morphine equivalent per 1 mg of drug
 * (per mcg for fentanyl IV; per mcg/hr-day for fentanyl transdermal).
 * Factors derived from the GlobalRPh equianalgesic table, with the
 * oral morphine = 30 mg / IV morphine = 10 mg chronic baseline.
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
  // Fentanyl IV/IM factor is per mcg (not mg). Transdermal factor is
  // per (mcg/hr) over 24 h: 25 mcg/hr patch ~= 60 MME / day.
  fentanyl:      { label: 'Fentanyl',      factors: { IV: 0.3,   IM: 0.3,  SC: 0.3,  TD: 2.4 } },
  // Methadone uses tiered factors based on total daily mg PO; see methadoneFactor().
  methadone:     { label: 'Methadone',     factors: { PO: 'tiered', IV: 6 } },
  // Levorphanol approximate (chronic PO).
  levorphanol:   { label: 'Levorphanol',   factors: { PO: 11 } },
  // Buprenorphine: variable / partial agonist - skip auto conversion.
  buprenorphine: { label: 'Buprenorphine', factors: {} },
  nalbuphine:    { label: 'Nalbuphine',    factors: { IV: 3, IM: 3, SC: 3 } },
  butorphanol:   { label: 'Butorphanol',   factors: { IV: 15, IM: 15 } },
};

// Aliases / brand names → canonical key.
const DRUG_ALIASES = {
  'ms contin': 'morphine',
  'msir': 'morphine',
  'roxanol': 'morphine',
  'duramorph': 'morphine',
  'dilaudid': 'hydromorphone',
  'exalgo': 'hydromorphone',
  'oxycontin': 'oxycodone',
  'roxicodone': 'oxycodone',
  'roxicet': 'oxycodone',
  'percocet': 'oxycodone',
  'oxyir': 'oxycodone',
  'opana': 'oxymorphone',
  'norco': 'hydrocodone',
  'vicodin': 'hydrocodone',
  'lortab': 'hydrocodone',
  'lorcet': 'hydrocodone',
  'hysingla': 'hydrocodone',
  'zohydro': 'hydrocodone',
  'tylenol with codeine': 'codeine',
  'ultram': 'tramadol',
  'nucynta': 'tapentadol',
  'demerol': 'meperidine',
  'duragesic': 'fentanyl',
  'sublimaze': 'fentanyl',
  'actiq': 'fentanyl',
  'fentora': 'fentanyl',
  'subsys': 'fentanyl',
  'methadose': 'methadone',
  'dolophine': 'methadone',
  'levo-dromoran': 'levorphanol',
  'subutex': 'buprenorphine',
  'suboxone': 'buprenorphine',
  'butrans': 'buprenorphine',
  'nubain': 'nalbuphine',
  'stadol': 'butorphanol',
};

// Methadone PO MME factor (CDC tiered, oral morphine equivalent per 1 mg methadone).
function methadoneFactor(totalDailyMg) {
  if (totalDailyMg <= 20) return 4;
  if (totalDailyMg <= 40) return 8;
  if (totalDailyMg <= 60) return 10;
  return 12;
}

// Reverse for "convert TO methadone": morphine→methadone (GlobalRPh tiered).
function methadoneTargetFactor(mmeTotal) {
  // returns mg morphine per 1 mg methadone
  if (mmeTotal <= 99)   return 4;
  if (mmeTotal <= 299)  return 8;
  if (mmeTotal <= 499)  return 12;
  if (mmeTotal <= 999)  return 15;
  if (mmeTotal <= 1999) return 20;
  return 30;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

const ROUTE_PATTERNS = [
  { rx: /\btransdermal\b|\bpatch\b|mcg\s*\/\s*hr/i, route: 'TD' },
  { rx: /\bIV\b|\bintraven/i,                       route: 'IV' },
  { rx: /\bIM\b|\bintramuscul/i,                    route: 'IM' },
  { rx: /\bSC\b|\bSUBQ\b|\bsubcut/i,                route: 'SC' },
  { rx: /\bsublingual\b|\bSL\b/i,                   route: 'SL' },
  { rx: /\bPO\b|\boral\b|\btab\b|\bcap(?:sule)?\b|\bsoln\b|\bsolution\b|\bsuspension\b|\belixir\b|\bliquid\b/i, route: 'PO' },
];

function detectRoute(orderLine) {
  for (const p of ROUTE_PATTERNS) {
    if (p.rx.test(orderLine)) return p.route;
  }
  return 'PO'; // default fallback
}

function matchDrugHeader(line) {
  // Strip leading bullets / numbers, normalize spaces.
  const clean = line.replace(/^[\s••\-*]+/, '').trim();
  if (!clean) return null;

  // Header lines are short-ish and start with a drug name; bail on long sentences.
  if (clean.length > 120) return null;

  // Try direct match first (e.g. "HYDROmorphone", "OxyMORPHone (Dilaudid inj)").
  const firstWord = clean.split(/[\s(,]/)[0].toLowerCase();
  if (DRUGS[firstWord]) return firstWord;

  // Try parenthetical content too (e.g. "(Dilaudid inj)").
  const parenMatch = clean.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const parenWord = parenMatch[1].split(/[\s,]/)[0].toLowerCase();
    if (DRUGS[parenWord]) return parenWord;
    if (DRUG_ALIASES[parenWord]) return DRUG_ALIASES[parenWord];
  }

  if (DRUG_ALIASES[firstWord]) return DRUG_ALIASES[firstWord];

  // Multi-word alias lookup against the whole clean string.
  const lower = clean.toLowerCase();
  for (const alias in DRUG_ALIASES) {
    if (alias.includes(' ') && lower.startsWith(alias)) return DRUG_ALIASES[alias];
  }
  return null;
}

function matchOrderLine(line) {
  // Order lines start with an optional "or ", then a dose like "0.5 mg" or "25 mcg/hr",
  // followed by a comma — which distinguishes them from triplet dose lines (no comma).
  const m = line.match(/^(?:or\s+)?([\d.]+)\s*(mg|mcg|g)\b(?:\s*\/\s*hr)?\s*[,;]/i);
  if (!m) return null;
  const strength = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const isRate = /mcg\s*\/\s*hr/i.test(line) || /\bpatch\b/i.test(line);
  const route = isRate ? 'TD' : detectRoute(line);
  return { strength, unit, route, raw: line };
}

function matchDateLine(s) {
  return /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
}
function matchTimeLine(s) {
  return /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(s);
}
function matchDoseLine(s) {
  return /^([\d.]+)\s*(mg|mcg|g)$/i.exec(s);
}

function parseTimestamp(dateStr, timeStr) {
  const [mo, d, y] = dateStr.split('/').map(Number);
  const yr = y < 100 ? 2000 + y : y;
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(yr, mo - 1, d, hh, mm).getTime();
}

function parseMAR(text) {
  const warnings = [];
  const orders = [];
  if (!text || !text.trim()) return { orders, warnings };

  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = rawLines.map(l => l.trim());

  let currentDrug = null;
  let currentOrder = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line) { i++; continue; }

    // 1. Drug header?
    const drug = matchDrugHeader(line);
    // Heuristic: only treat as a drug header if the line is shortish AND doesn't
    // start with a number (those are order lines or doses).
    if (drug && !/^[\d.]/.test(line)) {
      currentDrug = drug;
      currentOrder = null;
      i++;
      continue;
    }

    // 2. Order line?
    const order = matchOrderLine(line);
    if (order) {
      if (!currentDrug) {
        // We saw an order without a drug header — skip but warn.
        warnings.push('Found a dose order line without a recognized drug header: "' + truncate(line, 60) + '"');
        i++;
        continue;
      }
      currentOrder = {
        drug: currentDrug,
        route: order.route,
        strength: order.strength,
        strengthUnit: order.unit,
        rawOrder: line,
        admins: [],
      };
      orders.push(currentOrder);
      i++;
      continue;
    }

    // 3. Admin triplet (date / time / dose)?
    if (i + 2 < lines.length) {
      const dm = matchDateLine(lines[i]);
      const tm = dm && matchTimeLine(lines[i + 1]);
      const ddm = tm && matchDoseLine(lines[i + 2]);
      if (dm && tm && ddm) {
        if (!currentOrder) {
          warnings.push('Found dose history without a preceding order line — skipping.');
          i += 3;
          continue;
        }
        currentOrder.admins.push({
          date: lines[i],
          time: lines[i + 1],
          dose: parseFloat(ddm[1]),
          unit: ddm[2].toLowerCase(),
          ts: parseTimestamp(lines[i], lines[i + 1]),
        });
        i += 3;
        continue;
      }
    }

    // Otherwise it's a comment/PRN instruction — ignore.
    i++;
  }

  // Strip any orders that have zero administrations recorded.
  const used = orders.filter(o => o.admins.length > 0);
  if (orders.length > used.length) {
    warnings.push((orders.length - used.length) + ' order(s) had no recorded administrations and were omitted.');
  }
  return { orders: used, warnings };
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ------------------------------------------------------------------ *
 * MME calculation
 * ------------------------------------------------------------------ */

function filterAdminsByWindow(admins, windowHours, anchorTs) {
  if (admins.length === 0) return { kept: [], windowStart: null, windowEnd: null, mode: 'window' };
  if (windowHours === 'all') {
    const start = Math.min(...admins.map(a => a.ts));
    const end   = Math.max(...admins.map(a => a.ts));
    return { kept: admins.slice(), windowStart: start, windowEnd: end, mode: 'all' };
  }
  const hrs = Number(windowHours);
  const windowStart = anchorTs - hrs * 3600 * 1000;
  const kept = admins.filter(a => a.ts >= windowStart && a.ts <= anchorTs);
  return { kept, windowStart, windowEnd: anchorTs, mode: 'window' };
}

function computeOrderMME(order, windowHours, anchorTs) {
  const drugInfo = DRUGS[order.drug];
  const { kept, windowStart, windowEnd, mode } = filterAdminsByWindow(order.admins, windowHours, anchorTs);

  let totalDose = kept.reduce((s, a) => s + a.dose, 0);
  let unit = kept[0] ? kept[0].unit : order.strengthUnit;

  // Normalize g → mg
  if (unit === 'g') { totalDose *= 1000; unit = 'mg'; }

  // If summing across more than 24h in "all" mode, normalize to a daily rate.
  let normalizedDaily = totalDose;
  let spanHours = null;
  if (kept.length > 1) {
    spanHours = (Math.max(...kept.map(a => a.ts)) - Math.min(...kept.map(a => a.ts))) / 3600000;
  }
  if (mode === 'all' && spanHours && spanHours > 24) {
    normalizedDaily = (totalDose * 24) / spanHours;
  }

  // Transdermal fentanyl: doses are mcg/hr (patch strength), not a single bolus.
  // Take the *most recent* admin's value as the active patch rate.
  let mme = 0;
  let factorDescription = '';
  if (order.drug === 'fentanyl' && order.route === 'TD') {
    if (kept.length === 0) {
      mme = 0;
    } else {
      const latest = kept.reduce((a, b) => a.ts > b.ts ? a : b);
      const rate = latest.dose; // mcg/hr
      mme = rate * DRUGS.fentanyl.factors.TD;
      factorDescription = `${rate} mcg/hr × 2.4 MME per mcg/hr-day`;
    }
  } else if (order.drug === 'methadone' && order.route === 'PO') {
    const factor = methadoneFactor(normalizedDaily);
    mme = normalizedDaily * factor;
    factorDescription = `${formatNum(normalizedDaily)} mg/day × ${factor} (tiered)`;
  } else {
    const factor = drugInfo && drugInfo.factors ? drugInfo.factors[order.route] : null;
    if (factor == null || typeof factor !== 'number') {
      return {
        order, kept, totalDose, normalizedDaily, mme: null, factor: null,
        windowStart, windowEnd, mode, spanHours,
        factorDescription: 'No conversion factor available',
      };
    }
    mme = normalizedDaily * factor;
    const drugUnit = (order.drug === 'fentanyl') ? 'mcg' : 'mg';
    factorDescription = `${formatNum(normalizedDaily)} ${drugUnit}/day × ${factor}`;
  }

  return {
    order, kept, totalDose, normalizedDaily, mme,
    windowStart, windowEnd, mode, spanHours, factorDescription,
  };
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
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0');
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

let lastResults = null; // { rows: [computeOrderMME results], totalMME, warnings }

function render(parsedOrders, warnings) {
  const windowHours = document.getElementById('time-window').value;
  const anchorMode = document.getElementById('window-anchor').value;

  // Compute a single anchor timestamp shared across all orders so the window
  // is comparable (e.g. last 24 h means "ending at the latest dose in the
  // pasted data" or "ending now"), not per-order.
  let anchorTs;
  if (anchorMode === 'now') {
    anchorTs = Date.now();
  } else {
    const allTs = parsedOrders.flatMap(o => o.admins.map(a => a.ts));
    anchorTs = allTs.length ? Math.max(...allTs) : Date.now();
  }

  const rows = parsedOrders.map(o => computeOrderMME(o, windowHours, anchorTs));
  const totalMME = rows.reduce((s, r) => s + (r.mme || 0), 0);

  lastResults = { rows, totalMME, warnings };

  renderWarnings(warnings, rows);
  renderMedsTable(rows);
  renderTotals(rows, totalMME, windowHours);
  renderConversion();
}

function renderWarnings(warnings, rows) {
  const el = document.getElementById('warnings');
  const items = [];
  if (warnings && warnings.length) items.push(...warnings);
  rows.forEach(r => {
    if (r.mme == null) {
      items.push(`No factor for ${DRUGS[r.order.drug].label} (${r.order.route}) — excluded from total.`);
    }
    if (r.order.drug === 'methadone' && r.kept.length > 0) {
      items.push('Methadone conversions are highly variable. Confirm dose with a pain or palliative specialist.');
    }
    if (r.order.drug === 'fentanyl' && r.order.route === 'TD') {
      items.push('Fentanyl patch dose treated as continuous mcg/hr (latest value in window).');
    }
  });
  if (!items.length) { el.innerHTML = ''; return; }
  const uniq = Array.from(new Set(items));
  el.innerHTML = '<div class="warning"><strong>Notes</strong><ul>' +
    uniq.map(t => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div>';
}

function renderMedsTable(rows) {
  const wrap = document.getElementById('meds-table-wrap');
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-state">No medications parsed yet. Paste an MAR or use Manual entry.</p>';
    return;
  }
  const html = `
    <table class="meds">
      <thead>
        <tr>
          <th>Drug</th>
          <th>Route</th>
          <th class="num">Doses</th>
          <th class="num">Total (window)</th>
          <th class="num">Normalized / day</th>
          <th>Calc</th>
          <th class="num">MME / day</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const drug = DRUGS[r.order.drug] ? DRUGS[r.order.drug].label : r.order.drug;
          const routeClass = ({PO:'po', IV:'iv', IM:'iv', SC:'iv', TD:'td'})[r.order.route] || '';
          const unit = r.order.drug === 'fentanyl' ? 'mcg' : 'mg';
          const adminDetail = r.kept.length
            ? r.kept.slice(0, 6).map(a => formatDate(a.ts) + ' · ' + formatNum(a.dose) + a.unit).join(' &nbsp;|&nbsp; ') +
              (r.kept.length > 6 ? ' &nbsp;…' : '')
            : 'No administrations in window';
          return `
            <tr>
              <td>
                <div>${escapeHtml(drug)}</div>
                <div class="admin-detail" title="${escapeHtml(stripTags(adminDetail))}">${adminDetail}</div>
              </td>
              <td><span class="tag ${routeClass}">${r.order.route}</span></td>
              <td class="num">${r.kept.length}</td>
              <td class="num">${formatNum(r.totalDose)} ${unit}</td>
              <td class="num">${formatNum(r.normalizedDaily)} ${unit}</td>
              <td class="admin-detail" style="max-width:none">${escapeHtml(r.factorDescription)}</td>
              <td class="num mme">${r.mme == null ? '—' : formatNum(r.mme)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  wrap.innerHTML = html;
}

function renderTotals(rows, totalMME, windowHours) {
  document.getElementById('total-mme').textContent = formatNum(totalMME);
  const windowLabel = windowHours === 'all' ? 'all administrations (normalized to 24 h)' : `last ${windowHours} h`;
  const drugCount = rows.filter(r => r.mme && r.mme > 0).length;
  document.getElementById('totals-detail').textContent =
    `Sum across ${drugCount} medication${drugCount === 1 ? '' : 's'} · window: ${windowLabel}`;
}

function renderConversion() {
  const el = document.getElementById('conversion-result');
  if (!lastResults || lastResults.totalMME <= 0) { el.classList.remove('show'); el.innerHTML = ''; return; }

  const target = document.getElementById('target-drug').value;
  if (!target) { el.classList.remove('show'); el.innerHTML = ''; return; }

  const [drugKey, route] = target.split('|');
  const reduction = Number(document.getElementById('reduction').value) / 100;
  const mme = lastResults.totalMME;
  const adjMME = mme * (1 - reduction);

  let dose, unit, calcDesc;
  if (drugKey === 'methadone' && route === 'PO') {
    const ratio = methadoneTargetFactor(adjMME); // mg morphine per mg methadone
    dose = adjMME / ratio;
    unit = 'mg/day PO';
    calcDesc = `${formatNum(adjMME)} MME ÷ ${ratio} (tiered methadone ratio)`;
  } else if (drugKey === 'fentanyl' && route === 'TD') {
    dose = adjMME / DRUGS.fentanyl.factors.TD;
    unit = 'mcg/hr patch';
    calcDesc = `${formatNum(adjMME)} MME ÷ 2.4 MME per mcg/hr-day`;
  } else if (drugKey === 'fentanyl' && route === 'IV') {
    dose = adjMME / DRUGS.fentanyl.factors.IV; // mcg / day
    unit = 'mcg/day IV';
    calcDesc = `${formatNum(adjMME)} MME ÷ 0.3 MME per mcg`;
  } else {
    const factor = DRUGS[drugKey].factors[route];
    if (typeof factor !== 'number') {
      el.classList.add('show');
      el.innerHTML = '<strong>No conversion factor</strong> available for this target.';
      return;
    }
    dose = adjMME / factor;
    unit = `mg/day ${route}`;
    calcDesc = `${formatNum(adjMME)} MME ÷ ${factor}`;
  }

  const drugLabel = DRUGS[drugKey].label;
  const reductionText = reduction > 0
    ? `Applied ${(reduction * 100).toFixed(0)}% cross-tolerance reduction (${formatNum(mme)} → ${formatNum(adjMME)} MME).`
    : 'No cross-tolerance reduction applied.';
  el.classList.add('show');
  el.innerHTML = `
    <div>Equivalent dose of <strong>${escapeHtml(drugLabel)}</strong>:</div>
    <div class="target-dose">${formatNum(dose)} ${escapeHtml(unit)}</div>
    <div class="breakdown">${escapeHtml(calcDesc)}<br>${escapeHtml(reductionText)}</div>
  `;
}

/* ------------------------------------------------------------------ *
 * Manual entry
 * ------------------------------------------------------------------ */

function buildManualRow() {
  const row = document.createElement('div');
  row.className = 'manual-row';
  row.innerHTML = `
    <div>
      <label>Drug</label>
      <select class="m-drug">
        ${Object.keys(DRUGS).map(k => `<option value="${k}">${DRUGS[k].label}</option>`).join('')}
      </select>
    </div>
    <div>
      <label>Route</label>
      <select class="m-route">
        <option value="PO">PO</option>
        <option value="IV">IV / IM / SC</option>
        <option value="TD">Transdermal</option>
      </select>
    </div>
    <div>
      <label>Dose</label>
      <input class="m-dose" type="number" min="0" step="any" placeholder="e.g. 5">
    </div>
    <div>
      <label>per day</label>
      <input class="m-freq" type="number" min="0" step="any" value="1" placeholder="× / day">
    </div>
    <div>
      <button type="button" class="icon-btn m-remove" title="Remove">×</button>
    </div>
  `;
  row.querySelector('.m-remove').addEventListener('click', () => { row.remove(); recomputeManual(); });
  row.querySelectorAll('input, select').forEach(el =>
    el.addEventListener('input', recomputeManual)
  );
  return row;
}

function recomputeManual() {
  const rows = Array.from(document.querySelectorAll('.manual-row'));
  const orders = [];
  const warnings = [];
  rows.forEach(r => {
    const drug = r.querySelector('.m-drug').value;
    const route = r.querySelector('.m-route').value;
    const dose = parseFloat(r.querySelector('.m-dose').value);
    const freq = parseFloat(r.querySelector('.m-freq').value);
    if (!isFinite(dose) || !isFinite(freq) || dose <= 0) return;
    const total = dose * freq;
    // Synthesize a single "admin" so the existing renderer works.
    const ts = Date.now();
    const unit = (drug === 'fentanyl') ? 'mcg' : 'mg';
    orders.push({
      drug,
      route,
      strength: dose,
      strengthUnit: unit,
      rawOrder: `${dose} ${unit} ${route} × ${freq}/day`,
      admins: [{ date: '', time: '', dose: total, unit, ts }],
    });
  });
  render(orders, warnings);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

const EXAMPLE = `HYDROmorphone (Dilaudid inj)
0.5 mg, 0.25 mL, IV, q3 hr, PRN: Moderate to Severe Pain
Started: Sikora MD, Kenneth R (IHI) 5/25/26 • 07:02
Ended: 5/25/26 • 22:55
PRN severe pain uncontrolled by PO or if unable to take PO. Hold for RR<10, SBP<90, POSS 3+.
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
Started: Sikora MD, Kenneth R (IHI) 5/22/26 • 11:07
Ended: 5/25/26 • 07:02
5/25/26
05:26
0.75 mg
5/25/26
02:24
0.75 mg
5/24/26
22:14
0.75 mg
5/24/26
20:08
0.75 mg
5/24/26
17:31
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

function init() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + '-panel').classList.add('active');
      // Recompute when switching tabs so the displayed results match the active mode.
      if (btn.dataset.tab === 'manual') recomputeManual();
      else doParse();
    });
  });

  document.getElementById('parse-btn').addEventListener('click', doParse);
  document.getElementById('clear-btn').addEventListener('click', () => {
    document.getElementById('input-text').value = '';
    render([], []);
  });
  document.getElementById('example-btn').addEventListener('click', () => {
    document.getElementById('input-text').value = EXAMPLE;
    doParse();
  });

  document.getElementById('time-window').addEventListener('change', () => {
    const active = document.querySelector('.tab.active').dataset.tab;
    if (active === 'manual') recomputeManual(); else doParse();
  });
  document.getElementById('window-anchor').addEventListener('change', () => {
    const active = document.querySelector('.tab.active').dataset.tab;
    if (active === 'manual') recomputeManual(); else doParse();
  });

  document.getElementById('target-drug').addEventListener('change', renderConversion);
  document.getElementById('reduction').addEventListener('change', renderConversion);

  // Manual entry — start with one row.
  document.getElementById('add-row-btn').addEventListener('click', () => {
    document.getElementById('manual-rows').appendChild(buildManualRow());
  });
  document.getElementById('manual-rows').appendChild(buildManualRow());
}

function doParse() {
  const text = document.getElementById('input-text').value;
  const { orders, warnings } = parseMAR(text);
  render(orders, warnings);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
