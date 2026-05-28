// Timeline view: per-dose PK curves on a single SVG chart, with the admin
// list that drives them. Pulls admins from the ledger; parsed MAR entries
// carry real timestamps, manual / PCA entries get evenly-spaced synthetic
// times across the most-recent 24h so they still show up.

import { ledger, setAdminTime } from './ledger.js';
import { DRUGS, ROUTE_LABELS, drugUnit } from './drugs.js';
import { getFactor, methadoneInFactor } from './tables.js';
import { doseIntensity, doseDurationMin, getPK, organMultiplier } from './pk.js';
import { formatNum } from './mme.js';
import { patientContext, saveContext, isContextActive } from './settings.js';

const STATE_KEY = 'mme.timeline.v1';
export const timelineState = {
  windowH: 24,
  show: 'both',    // 'individual' | 'total' | 'both'
  anchor: 'now',   // 'now' | 'latest'
};

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') Object.assign(timelineState, s);
  } catch (e) {}
}
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(timelineState)); } catch (e) {}
}

// Stable per-drug color from the warm palette. Cycles if more drugs appear.
const DRUG_COLORS = [
  '#7a5417', '#335963', '#823028', '#4c6437', '#7c5a8a',
  '#a36b1f', '#2f6e6b', '#8a3a4d', '#5b6b34', '#604a8a',
];
const drugColorCache = new Map();
function colorFor(drug) {
  if (!drugColorCache.has(drug)) {
    drugColorCache.set(drug, DRUG_COLORS[drugColorCache.size % DRUG_COLORS.length]);
  }
  return drugColorCache.get(drug);
}

// Per-admin MME (single dose, not daily). Methadone uses the entry's daily
// tier so a 10 mg dose inside a 40 mg/day regimen scores 80 MME (10×8), not
// 40 (10×4). Patch entries are special: the curve's plateau encodes the
// daily MME of the patch rate, so we return that here.
function adminMME(entry, admin) {
  const drug = entry.drug, route = entry.route;
  if (drug === 'fentanyl' && route === 'TD') {
    const rate = admin.dose;
    return rate * getFactor('fentanyl', 'TD');
  }
  if (drug === 'methadone' && route === 'PO') {
    const daily = entry.admins.reduce((s, a) => s + a.dose, 0);
    const tier = methadoneInFactor(daily);
    return admin.dose * tier;
  }
  const f = getFactor(drug, route);
  return (typeof f === 'number') ? admin.dose * f : 0;
}

// Expand the ledger into one flat list of dose events, each with a real ts.
// Synthesises times for manual / PCA entries: evenly spaced across the most
// recent 24h. PCA effective-daily becomes a single basal-equivalent admin at
// the start of the window so the curve covers the day.
export function collectDoses() {
  const out = [];
  const now = Date.now();
  ledger.forEach(entry => {
    const drug = entry.drug, route = entry.route;
    const label = DRUGS[drug] ? DRUGS[drug].label : drug;
    const routeLbl = ROUTE_LABELS[route] || route;
    const isReal = entry.source === 'parsed' || entry._timesSet;
    if (!isReal) {
      // Manual or PCA, no user-set times yet: synthesise admins across last
      // 24h. adminIdx mirrors the index that materialisation will use, so
      // the first time the user edits a row the dose-to-admin mapping holds.
      if (drug === 'fentanyl' && route === 'TD') {
        out.push({
          ts: now - 24 * 3600 * 1000,
          drug, route, label, routeLbl,
          dose: entry._dose || (entry.admins[0] && entry.admins[0].dose) || 0,
          unit: 'mcg/hr',
          mme: adminMME(entry, { dose: entry._dose || entry.admins[0].dose }),
          synthetic: true, entryId: entry.id, adminIdx: 0,
        });
        return;
      }
      const perDay = Math.max(1, Math.round(entry._perDay || entry._demands || 1));
      const perDose = entry._dose || (entry.admins[0] && entry.admins[0].dose / perDay) || 0;
      const intervalMs = (24 * 3600 * 1000) / perDay;
      const last = now - 30 * 60 * 1000;
      for (let i = 0; i < perDay; i++) {
        const ts = last - i * intervalMs;
        out.push({
          ts, drug, route, label, routeLbl,
          dose: perDose, unit: drugUnit(drug),
          mme: adminMME(entry, { dose: perDose }),
          synthetic: true, entryId: entry.id, adminIdx: i,
        });
      }
      return;
    }
    // Real admins: either parsed MAR or a manual entry whose times have been
    // edited (and so materialised) by the user.
    entry.admins.forEach((a, idx) => {
      if (!a.ts) return;
      const isTD = drug === 'fentanyl' && route === 'TD';
      out.push({
        ts: a.ts, drug, route, label, routeLbl,
        dose: a.dose, unit: a.unit || (isTD ? 'mcg/hr' : drugUnit(drug)),
        mme: adminMME(entry, a),
        synthetic: false, entryId: entry.id, adminIdx: idx,
      });
    });
  });
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

// ---------- SVG chart ----------

const VB_W = 1000, VB_H = 360;
const PAD = { top: 18, right: 18, bottom: 36, left: 50 };

function tickHoursFor(windowH) {
  // Aim for ~6 evenly-spaced ticks. Snap to a clinically-natural step so
  // the labels read as "−12h" / "−1d" / "−3d" rather than awkward fractions.
  const target = windowH / 6;
  const steps = [1, 2, 4, 6, 12, 24, 48, 72, 168, 336, 720];
  for (const s of steps) if (target <= s) return s;
  return steps[steps.length - 1];
}

function buildChartSVG(doses, opts) {
  const { windowH, anchorTs, show } = opts;
  const startTs = anchorTs - windowH * 3600 * 1000;
  const endTs = anchorTs;
  const innerW = VB_W - PAD.left - PAD.right;
  const innerH = VB_H - PAD.top - PAD.bottom;

  // Sample each dose's curve over the visible window. Step adapts to window.
  const steps = 240;
  const dt = (endTs - startTs) / steps;
  const xs = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) xs[i] = startTs + i * dt;

  // doseSeries: { dose, ys[] }
  const ctx = patientContext;
  const doseSeries = doses.map(d => {
    const ys = new Array(steps + 1).fill(0);
    const durMs = doseDurationMin(d.drug, d.route, ctx) * 60 * 1000;
    if (d.ts > endTs || d.ts + durMs < startTs) return { dose: d, ys, peak: 0 };
    let peak = 0;
    for (let i = 0; i <= steps; i++) {
      const tMin = (xs[i] - d.ts) / 60000;
      const v = doseIntensity(d.drug, d.route, d.mme, tMin, ctx);
      ys[i] = v;
      if (v > peak) peak = v;
    }
    return { dose: d, ys, peak };
  }).filter(s => s.peak > 0.01);

  // Totals across all doses at each sample.
  const totals = new Array(steps + 1).fill(0);
  doseSeries.forEach(s => { for (let i = 0; i <= steps; i++) totals[i] += s.ys[i]; });
  let yMax = 0;
  if (show === 'total') {
    for (let i = 0; i <= steps; i++) if (totals[i] > yMax) yMax = totals[i];
  } else if (show === 'individual') {
    doseSeries.forEach(s => { if (s.peak > yMax) yMax = s.peak; });
  } else {
    for (let i = 0; i <= steps; i++) if (totals[i] > yMax) yMax = totals[i];
    doseSeries.forEach(s => { if (s.peak > yMax) yMax = s.peak; });
  }
  if (yMax <= 0) yMax = 1;
  // Pad headroom + nice round.
  yMax = niceMax(yMax * 1.08);

  const x = ts => PAD.left + ((ts - startTs) / (endTs - startTs)) * innerW;
  const y = v  => PAD.top + innerH - (v / yMax) * innerH;

  // Build path for a series.
  const pathFor = ys => {
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const px = x(xs[i]).toFixed(1);
      const py = y(ys[i]).toFixed(1);
      d += (i === 0 ? `M${px},${py}` : `L${px},${py}`);
    }
    return d;
  };

  // Gridlines + axes.
  const tickH = tickHoursFor(windowH);
  const xTicks = [];
  for (let h = 0; h <= windowH; h += tickH) {
    const ts = endTs - (windowH - h) * 3600 * 1000;
    xTicks.push({ x: x(ts), label: tickLabel(ts, anchorTs, windowH) });
  }
  const yTicks = [];
  const yStep = niceStep(yMax / 4);
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    yTicks.push({ y: y(v), label: formatNum(v) });
  }

  // Compose SVG.
  let svg = `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" class="pk-svg" role="img" aria-label="Pharmacokinetic dose curves">`;
  // Grid.
  svg += `<g class="pk-grid">`;
  yTicks.forEach(t => {
    svg += `<line x1="${PAD.left}" x2="${VB_W - PAD.right}" y1="${t.y}" y2="${t.y}"/>`;
  });
  svg += `</g>`;
  // Axes.
  svg += `<line class="pk-axis" x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${VB_H - PAD.bottom}"/>`;
  svg += `<line class="pk-axis" x1="${PAD.left}" x2="${VB_W - PAD.right}" y1="${VB_H - PAD.bottom}" y2="${VB_H - PAD.bottom}"/>`;
  // Y labels.
  yTicks.forEach(t => {
    svg += `<text class="pk-tick" x="${PAD.left - 6}" y="${t.y + 3}" text-anchor="end">${t.label}</text>`;
  });
  // X labels.
  xTicks.forEach(t => {
    svg += `<text class="pk-tick" x="${t.x}" y="${VB_H - PAD.bottom + 14}" text-anchor="middle">${escapeXML(t.label)}</text>`;
  });
  // "Now" marker.
  const nowX = x(anchorTs);
  svg += `<line class="pk-now" x1="${nowX}" x2="${nowX}" y1="${PAD.top}" y2="${VB_H - PAD.bottom}"/>`;
  svg += `<text class="pk-now-label" x="${nowX - 4}" y="${PAD.top + 10}" text-anchor="end">${opts.anchor === 'now' ? 'now' : 'latest'}</text>`;

  // Individual dose lines.
  if (show !== 'total') {
    doseSeries.forEach(s => {
      const c = colorFor(s.dose.drug);
      svg += `<path class="pk-dose-line" d="${pathFor(s.ys)}" stroke="${c}" />`;
    });
  }
  // Total overlay.
  if (show !== 'individual' && doseSeries.length > 1) {
    svg += `<path class="pk-total-line" d="${pathFor(totals)}" />`;
  }
  // Axis labels.
  svg += `<text class="pk-axis-label" x="${PAD.left}" y="${PAD.top - 6}">Effect (MME-scaled)</text>`;
  svg += `<text class="pk-axis-label" x="${VB_W - PAD.right}" y="${VB_H - 6}" text-anchor="end">Hours</text>`;

  svg += `</svg>`;
  return svg;
}

function tickLabel(ts, anchorTs, windowH) {
  const deltaH = Math.round((anchorTs - ts) / 3600000);
  if (deltaH === 0) return '0';
  // Pick the label unit once per chart so every x-tick is in the same
  // dimension (hours, days, or calendar dates) rather than a mix.
  if (windowH > 14 * 24) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }
  if (windowH > 72) {
    const days = Math.round(deltaH / 24);
    return days <= 0 ? '0' : `−${days}d`;
  }
  return `−${deltaH}h`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / exp;
  let nice;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 2.5) nice = 2.5;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}
function niceStep(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / exp;
  let nice;
  if (m < 1.5) nice = 1;
  else if (m < 3) nice = 2;
  else if (m < 7) nice = 5;
  else nice = 10;
  return nice * exp;
}

function escapeXML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toLocalInputValue(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderAdminList(doses) {
  if (!doses.length) {
    return `<p class="empty-state">No doses to plot. Add medications in Simple or Complex, or paste an MAR.</p>`;
  }
  const rows = doses.map(d => {
    const drugLbl = `<span class="pk-dot" style="background:${colorFor(d.drug)}"></span>${d.label}`;
    const doseStr = `${formatNum(d.dose)} ${d.unit}`;
    const mmeStr = formatNum(d.mme);
    const inputVal = toLocalInputValue(d.ts);
    const implied = d.synthetic ? ' <em class="pk-implied" title="Synthesised from the dose schedule. Edit to set a real time.">implied</em>' : '';
    const pk = getPK(d.drug, d.route);
    const mult = organMultiplier(d.drug, patientContext);
    const adjChip = mult > 1.001 ? ` <span class="pk-mult" title="Half-life multiplier from patient context">×${mult.toFixed(2)}</span>` : '';
    const pkStr = pk ? (pk.plateauMin != null
      ? `onset ${Math.round(pk.onsetMin / 60)}h, decay t½ ${formatHalfLife(pk.decayHalfLifeMin * mult)}${adjChip}`
      : `peak ${pk.peakMin}m, t½ ${formatHalfLife(pk.halfLifeMin * mult)}${adjChip}`)
      : '<span class="muted">no PK data</span>';
    return `<tr>
      <td class="pk-when">
        <input type="datetime-local" class="pk-time-input" value="${inputVal}"
          data-entry-id="${d.entryId}" data-admin-idx="${d.adminIdx}"
          aria-label="Administration time">
        ${implied}
      </td>
      <td class="pk-drug">${drugLbl}</td>
      <td>${d.routeLbl}</td>
      <td class="num">${doseStr}</td>
      <td class="num">${mmeStr} MME</td>
      <td class="pk-meta">${pkStr}</td>
    </tr>`;
  }).join('');
  return `<table class="pk-admins">
    <thead><tr><th>When</th><th>Drug</th><th>Route</th><th class="num">Dose</th><th class="num">MME</th><th>PK</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function formatHalfLife(min) {
  if (min < 60) return `${min}m`;
  if (min < 120) return `${(min / 60).toFixed(1)}h`;
  return `${Math.round(min / 60)}h`;
}

function syncCtxSelectors() {
  const age = document.getElementById('pk-age');
  const renal = document.getElementById('pk-renal');
  const hepatic = document.getElementById('pk-hepatic');
  if (age) age.value = patientContext.age;
  if (renal) renal.value = patientContext.renal;
  if (hepatic) hepatic.value = patientContext.hepatic;
  const note = document.getElementById('pk-ctx-note');
  if (note) note.hidden = !isContextActive();
}

// For the "all" window: span from the earliest dose to the anchor, with a
// small headroom so the leftmost curve onset isn't clipped, and a 24h minimum
// so a single recent dose doesn't collapse to a degenerate range.
function spanAllHours(doses, anchorTs) {
  if (!doses.length) return 24;
  const earliest = Math.min(...doses.map(d => d.ts));
  const spanH = (anchorTs - earliest) / 3600000;
  return Math.max(24, Math.ceil(spanH * 1.05));
}

export function renderTimeline() {
  const chartEl = document.getElementById('pk-chart');
  const listEl = document.getElementById('pk-admin-list');
  if (!chartEl || !listEl) return;
  syncCtxSelectors();
  const doses = collectDoses();
  const anchorTs = timelineState.anchor === 'latest'
    ? (doses.length ? doses[0].ts : Date.now())
    : Date.now();
  const windowH = timelineState.windowH === 'all'
    ? spanAllHours(doses, anchorTs)
    : Number(timelineState.windowH);
  chartEl.innerHTML = doses.length
    ? buildChartSVG(doses, { windowH, anchorTs, show: timelineState.show, anchor: timelineState.anchor })
    : `<p class="empty-state">No doses yet. Add medications or paste an MAR.</p>`;
  listEl.innerHTML = renderAdminList(doses);
}

export function wireTimeline() {
  loadState();
  const winSel = document.getElementById('pk-window');
  const showSel = document.getElementById('pk-show');
  const anchorSel = document.getElementById('pk-anchor');
  if (winSel) {
    winSel.value = String(timelineState.windowH);
    winSel.addEventListener('change', () => {
      timelineState.windowH = winSel.value === 'all' ? 'all' : Number(winSel.value);
      saveState();
      renderTimeline();
    });
  }
  if (showSel) {
    showSel.value = timelineState.show;
    showSel.addEventListener('change', () => { timelineState.show = showSel.value; saveState(); renderTimeline(); });
  }
  if (anchorSel) {
    anchorSel.value = timelineState.anchor;
    anchorSel.addEventListener('change', () => { timelineState.anchor = anchorSel.value; saveState(); renderTimeline(); });
  }
  // Patient-context selectors. Shared with the Complex view's Patient context
  // card via the same patientContext object, so edits here also tailor the
  // safety alerts the Complex view shows, and vice versa.
  const ageSel = document.getElementById('pk-age');
  const renalSel = document.getElementById('pk-renal');
  const hepaticSel = document.getElementById('pk-hepatic');
  const bindCtx = (el, key) => {
    if (!el) return;
    el.addEventListener('change', () => {
      patientContext[key] = el.value;
      saveContext();
      renderTimeline();
    });
  };
  bindCtx(ageSel, 'age');
  bindCtx(renalSel, 'renal');
  bindCtx(hepaticSel, 'hepatic');
  syncCtxSelectors();
  // Delegated change handler for the per-dose time inputs. setAdminTime
  // saves + notifies, which fans out to renderTimeline via the ledger
  // subscription wired in main.js.
  const list = document.getElementById('pk-admin-list');
  if (list) {
    list.addEventListener('change', e => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.classList.contains('pk-time-input')) return;
      const entryId = Number(t.dataset.entryId);
      const adminIdx = Number(t.dataset.adminIdx);
      const ts = new Date(t.value).getTime();
      if (Number.isFinite(ts)) setAdminTime(entryId, adminIdx, ts);
    });
  }
}
