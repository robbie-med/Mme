// Taper-schedule generator.
// Given the current daily dose / MME, produce a stepwise reduction plan to
// a target endpoint. Each step holds for a configurable interval (week /
// fortnight / month). Both per-drug dose and per-step MME are reported so
// the clinician can see when the patient crosses CDC tiers.
import { DRUGS } from './drugs.js';
import { previewMME, formatNum } from './mme.js';
import { roundSingleDose, unitFor } from './conversion.js';
import { getRiskTier } from './safety.js';
import { escapeHtml } from './util.js';

// Build the taper steps as plain data (drug-agnostic): an array of
// { stepNo, dose, perDay, mme, pctOfStart, intervalLabel }.
export function buildTaperSchedule({ drug, route, startingDose, startingPerDay,
                                     reductionPct, intervalDays, endpointMME,
                                     maxSteps = 24 }) {
  if (!isFinite(startingDose) || startingDose <= 0) return [];
  if (!isFinite(reductionPct) || reductionPct <= 0 || reductionPct >= 100) return [];
  const startMME = previewMME(drug, route, startingDose, startingPerDay);
  const intervalLabel = intervalLabelFor(intervalDays);

  const steps = [];
  steps.push({
    stepNo: 0,
    dose: startingDose,
    perDay: startingPerDay,
    mme: startMME,
    pctOfStart: 100,
    intervalLabel: 'Start',
  });

  let prevDose = startingDose;
  let prevMME  = startMME;
  for (let i = 1; i <= maxSteps; i++) {
    const targetDose = prevDose * (1 - reductionPct / 100);
    const rounded = roundSingleDose(targetDose, drug);
    // If rounding would not actually reduce the dose, force a one-step
    // decrement to avoid an infinite plateau.
    let effectiveDose = rounded;
    if (effectiveDose >= prevDose) {
      effectiveDose = Math.max(0, prevDose - smallestIncrement(drug));
    }
    if (effectiveDose <= 0) {
      steps.push({
        stepNo: i, dose: 0, perDay: startingPerDay, mme: 0, pctOfStart: 0,
        intervalLabel: `Week ${Math.round((i * intervalDays) / 7) || ''}`.trim().replace(/Week $/, 'Stop'),
      });
      break;
    }
    const stepMME = previewMME(drug, route, effectiveDose, startingPerDay);
    steps.push({
      stepNo: i,
      dose: effectiveDose,
      perDay: startingPerDay,
      mme: stepMME,
      pctOfStart: (stepMME / startMME) * 100,
      intervalLabel: intervalLabel(i),
    });
    if (endpointMME != null && stepMME <= endpointMME) break;
    prevDose = effectiveDose;
    prevMME  = stepMME;
  }
  return steps;
}

function smallestIncrement(drug) {
  if (drug === 'fentanyl')      return 1;
  if (drug === 'hydromorphone') return 0.5;
  if (drug === 'oxycodone' || drug === 'oxymorphone' || drug === 'methadone') return 2.5;
  if (drug === 'codeine')       return 15;
  if (drug === 'tramadol' || drug === 'tapentadol') return 25;
  return 5;
}

function intervalLabelFor(intervalDays) {
  // Returns a function (i) => "Week N" / "Day N" / etc.
  if (intervalDays === 7)  return i => `Week ${i}`;
  if (intervalDays === 14) return i => `Week ${i * 2}`;
  if (intervalDays === 28 || intervalDays === 30) return i => `Month ${i}`;
  return i => `Day ${i * intervalDays}`;
}

// Render the schedule as an HTML table.
export function renderTaperTable(schedule, drug) {
  if (!schedule || schedule.length === 0) {
    return '<p class="hint">Pick a reduction step and an endpoint to generate a schedule.</p>';
  }
  const u = unitFor(drug);
  const label = DRUGS[drug] ? DRUGS[drug].label : drug;
  const rows = schedule.map(s => {
    const tier = getRiskTier(s.mme);
    const doseStr = s.dose === 0
      ? '<em>stop</em>'
      : `${formatNum(s.dose)} ${u}${s.perDay && s.perDay !== 1 ? ' × ' + formatNum(s.perDay) + '/day' : ''}`;
    return `<tr>
      <td>${escapeHtml(s.intervalLabel)}</td>
      <td class="num">${doseStr}</td>
      <td class="num">${formatNum(s.mme)}</td>
      <td class="num">${formatNum(s.pctOfStart)}%</td>
      <td><span class="risk-badge risk-${tier.level}">${tier.label}</span></td>
    </tr>`;
  }).join('');
  return `<table class="taper-table">
    <thead><tr>
      <th>Period</th><th class="num">${escapeHtml(label)} dose</th>
      <th class="num">MME / day</th><th class="num">% of start</th><th>Risk tier</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// HTML for the "Plan a taper" collapsible section attached to a conversion
// primary regimen. Controls + an output div the wiring populates.
export function buildTaperSection(primary, startingMME) {
  if (!primary) return '';
  return `
    <details class="taper-section">
      <summary><span class="taper-summary-title">Plan a taper</span>
        <span class="taper-summary-hint">stepwise reduction from the proposed regimen</span>
      </summary>
      <div class="taper-controls">
        <label>Reduction per step
          <select id="taper-pct">
            <option value="10">10%</option>
            <option value="15">15%</option>
            <option value="25" selected>25%</option>
            <option value="50">50%</option>
          </select>
        </label>
        <label>Interval
          <select id="taper-interval">
            <option value="7" selected>Weekly</option>
            <option value="14">Every 2 weeks</option>
            <option value="28">Monthly</option>
          </select>
        </label>
        <label>Endpoint
          <select id="taper-endpoint">
            <option value="50">≤ 50% of starting MME</option>
            <option value="25">≤ 25% of starting MME</option>
            <option value="0" selected>Stop (0 MME)</option>
          </select>
        </label>
        <button id="taper-copy" class="ghost" type="button">Copy taper</button>
      </div>
      <div id="taper-output" class="taper-output"
        data-drug="${escapeHtml(primary.drug)}"
        data-route="${escapeHtml(primary.route)}"
        data-dose="${primary.dose}"
        data-perday="${primary.perDay}"
        data-startingmme="${startingMME}"></div>
    </details>`;
}

export function wireTaperControls(root) {
  const out = root.querySelector('#taper-output');
  if (!out) return;
  const drug = out.dataset.drug;
  const route = out.dataset.route;
  const startingDose = Number(out.dataset.dose);
  const startingPerDay = Number(out.dataset.perday);
  const startingMME = Number(out.dataset.startingmme);

  const refresh = () => {
    const pct = Number(root.querySelector('#taper-pct').value);
    const intervalDays = Number(root.querySelector('#taper-interval').value);
    const endpointPct = Number(root.querySelector('#taper-endpoint').value);
    const endpointMME = endpointPct === 0 ? -1 : startingMME * (endpointPct / 100);
    const schedule = buildTaperSchedule({
      drug, route, startingDose, startingPerDay,
      reductionPct: pct, intervalDays, endpointMME,
    });
    out.innerHTML = renderTaperTable(schedule, drug);
    out._schedule = schedule;
  };
  ['taper-pct', 'taper-interval', 'taper-endpoint'].forEach(id => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('change', refresh);
  });
  const copyBtn = root.querySelector('#taper-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const sched = out._schedule || [];
    const txt = renderTaperText(sched, drug);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
    } catch (e) {}
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = prev, 1200);
  });
  refresh();
}

// Render as plaintext for the clipboard.
export function renderTaperText(schedule, drug) {
  if (!schedule || schedule.length === 0) return '';
  const u = unitFor(drug);
  const label = DRUGS[drug] ? DRUGS[drug].label : drug;
  const lines = [`Taper schedule — ${label} (${u})`, ''];
  schedule.forEach(s => {
    const doseStr = s.dose === 0 ? 'stop' : `${formatNum(s.dose)} ${u}`;
    lines.push(`  ${s.intervalLabel.padEnd(10)} ${doseStr.padEnd(14)} ${formatNum(s.mme).padStart(5)} MME (${formatNum(s.pctOfStart)}% of start)`);
  });
  lines.push('');
  lines.push('Reassess pain control, function, and withdrawal symptoms at each step before proceeding.');
  return lines.join('\n');
}
