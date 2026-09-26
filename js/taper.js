// Taper-schedule generator.
// Starting from the proposed regimen, produce a stepwise reduction plan.
// Presets follow CDC 2022 Recommendation 5 (implementation considerations)
// and the ≤25% step limit in the opioid product labels. Every step is rounded
// DOWN to a dose that can actually be given; per-step MME is reported so the
// clinician can see tier crossings.
import { DRUGS } from './drugs.js';
import { previewMME, formatNum } from './mme.js';
import { floorToStep, unitFor, IR_FORMS } from './conversion.js';
import { getRiskTier } from './safety.js';
import { escapeHtml } from './util.js';

export const TAPER_PRESETS = {
  'cdc-long': {
    label: '10% of original dose per month (long-term use, ≥1 year)',
    cite: 'CDC 2022: tapers of ~10% per month or slower are better tolerated after long-term use (≥1 year).',
    intervalDays: 28,
    next: (orig, prev, k) => orig * (1 - 0.10 * k),
  },
  'cdc-short': {
    label: '10% of original per week, then 10% of remaining (weeks–months of use)',
    cite: 'CDC 2022: for shorter durations, 10% of the original dose per week or slower until ~30% of the original dose, then ~10% of the remaining dose weekly.',
    intervalDays: 7,
    next: (orig, prev, k) => (prev > orig * 0.30 + 1e-9 ? Math.max(orig * (1 - 0.10 * k), orig * 0.30) : prev * 0.90),
  },
  'label-max': {
    label: '25% of current dose every 2 weeks (fastest labeled rate)',
    cite: 'Opioid labels (e.g. fentanyl patch §2.9): decrease by no more than 25% of the total daily dose every 2 to 4 weeks.',
    intervalDays: 14,
    next: (orig, prev) => prev * 0.75,
  },
};

// Smallest dose unit for tapering a given primary regimen.
export function taperForm(primary) {
  const { drug, route } = primary;
  if (drug === 'fentanyl' && route === 'TD') return { step: 12.5, min: 12.5 };
  if (drug === 'fentanyl') return { step: 5, min: 5 };
  if (drug === 'methadone') return { step: 2.5, min: 2.5 };
  // ER strengths are too coarse for 10% steps; labels note a lower dosage
  // strength may be needed to taper, so step in immediate-release units.
  const f = (IR_FORMS[drug] || {})[route];
  return f ? { step: f.step, min: f.min } : { step: 1, min: 1 };
}

function periodLabel(k, intervalDays) {
  if (intervalDays % 28 === 0) return `Month ${k * intervalDays / 28}`;
  if (intervalDays % 7 === 0) return `Week ${k * intervalDays / 7}`;
  return `Day ${k * intervalDays}`;
}

// Build the taper steps as plain data:
// [{ stepNo, dose, perDay, mme, pctOfStart, intervalLabel }], plus a
// `truncated` flag on the array when maxSteps ran out before the endpoint.
export function buildTaperSchedule({ primary, presetKey, endpointPct = 0, maxSteps = 60 }) {
  const preset = TAPER_PRESETS[presetKey] || TAPER_PRESETS['cdc-long'];
  const { drug, route, dose: startDose, perDay } = primary;
  if (!isFinite(startDose) || startDose <= 0) return [];
  const form = taperForm(primary);
  const startMME = previewMME(drug, route, startDose, perDay);
  const endpointMME = endpointPct > 0 ? startMME * endpointPct / 100 : 0;
  const steps = [{ stepNo: 0, dose: startDose, perDay, mme: startMME, pctOfStart: 100, intervalLabel: 'Start' }];
  let prev = startDose;
  let reached = false;
  for (let k = 1; k <= maxSteps; k++) {
    const planned = preset.next(startDose, prev, k);
    let dose = floorToStep(planned, form.step);
    // Rounding can leave the dose unchanged; always move by at least one step.
    if (dose >= prev) dose = floorToStep(prev - form.step, form.step);
    if (dose < form.min) dose = 0;
    // Flag steps where rounding to a givable dose cut more than planned.
    const overshoot = dose > 0 && planned < prev && (prev - dose) > (prev - planned) * 1.25 + 1e-9;
    const mme = dose > 0 ? previewMME(drug, route, dose, perDay) : 0;
    steps.push({
      stepNo: k, dose, perDay, mme, overshoot,
      pctOfStart: startMME > 0 ? (mme / startMME) * 100 : 0,
      intervalLabel: dose === 0 ? `${periodLabel(k, preset.intervalDays)}: stop` : periodLabel(k, preset.intervalDays),
    });
    if (dose === 0 || (endpointMME > 0 && mme <= endpointMME)) { reached = true; break; }
    prev = dose;
  }
  steps.truncated = !reached;
  return steps;
}

function doseText(s, primary, u) {
  if (s.dose === 0) return 'stop';
  if (primary.drug === 'fentanyl' && primary.route === 'TD') return `${formatNum(s.dose === 12.5 ? 12 : s.dose)} mcg/hr patch`;
  if (primary.drug === 'fentanyl') return `${formatNum(s.dose)} mcg/hr`;
  return `${formatNum(s.dose)} ${u}${s.perDay && s.perDay !== 1 ? ' × ' + formatNum(s.perDay) + '/day' : ' once daily'}`;
}

export function renderTaperTable(schedule, primary) {
  if (!schedule || schedule.length === 0) {
    return '<p class="hint">Pick a taper preset and an endpoint to generate a schedule.</p>';
  }
  const u = unitFor(primary.drug);
  const label = DRUGS[primary.drug] ? DRUGS[primary.drug].label : primary.drug;
  const rows = schedule.map(s => {
    const tier = getRiskTier(s.mme);
    return `<tr>
      <td>${escapeHtml(s.intervalLabel)}${s.overshoot ? ' *' : ''}</td>
      <td class="num">${s.dose === 0 ? '<em>stop</em>' : escapeHtml(doseText(s, primary, u))}</td>
      <td class="num">${formatNum(s.mme)}</td>
      <td class="num">${formatNum(s.pctOfStart)}%</td>
      <td><span class="risk-badge risk-${tier.level}">${tier.label}</span></td>
    </tr>`;
  }).join('');
  const erNote = primary.er
    ? '<p class="hint">Steps below the smallest ER strength, or between ER strengths, need an immediate-release product or a lower strength.</p>' : '';
  const over = schedule.some(s => s.overshoot)
    ? '<p class="hint">* Rounding to the smallest givable dose makes this step larger than planned. Consider holding the previous step longer or using an oral solution.</p>' : '';
  const trunc = schedule.truncated
    ? `<p class="hint">Schedule shown for ${schedule.length - 1} steps; the endpoint was not reached within that horizon.</p>` : '';
  return `<table class="taper-table">
    <thead><tr>
      <th>Period</th><th class="num">${escapeHtml(label)} dose</th>
      <th class="num">MME / day</th><th class="num">% of start</th><th>Risk tier</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>${over}${erNote}${trunc}`;
}

export function buildTaperSection(primary, startingMME) {
  if (!primary) return '';
  const opts = Object.keys(TAPER_PRESETS).map(k =>
    `<option value="${k}"${k === 'cdc-long' ? ' selected' : ''}>${escapeHtml(TAPER_PRESETS[k].label)}</option>`).join('');
  return `
    <details class="taper-section">
      <summary><span class="taper-summary-title">Plan a taper</span>
        <span class="taper-summary-hint">from the proposed regimen above (${formatNum(startingMME)} MME/day)</span>
      </summary>
      <div class="taper-controls">
        <label>Preset
          <select id="taper-preset">${opts}</select>
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
      <p class="hint" id="taper-cite"></p>
      <div id="taper-output" class="taper-output"
        data-drug="${escapeHtml(primary.drug)}"
        data-route="${escapeHtml(primary.route)}"
        data-dose="${primary.dose}"
        data-perday="${primary.perDay}"
        data-er="${primary.er ? '1' : ''}"></div>
    </details>`;
}

export function wireTaperControls(root) {
  const out = root.querySelector('#taper-output');
  if (!out) return;
  const primary = {
    drug: out.dataset.drug,
    route: out.dataset.route,
    dose: Number(out.dataset.dose),
    perDay: Number(out.dataset.perday),
    er: out.dataset.er === '1',
  };
  const refresh = () => {
    const presetKey = root.querySelector('#taper-preset').value;
    const endpointPct = Number(root.querySelector('#taper-endpoint').value);
    const schedule = buildTaperSchedule({ primary, presetKey, endpointPct });
    out.innerHTML = renderTaperTable(schedule, primary);
    const cite = root.querySelector('#taper-cite');
    if (cite) cite.textContent = TAPER_PRESETS[presetKey].cite + ' Reassess pain, function and withdrawal before each step; pause or slow as needed.';
    out._schedule = schedule;
  };
  ['taper-preset', 'taper-endpoint'].forEach(id => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('change', refresh);
  });
  const copyBtn = root.querySelector('#taper-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const txt = renderTaperText(out._schedule || [], primary, root.querySelector('#taper-preset').value);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
    } catch (e) {}
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = prev, 1200);
  });
  refresh();
}

export function renderTaperText(schedule, primary, presetKey) {
  if (!schedule || schedule.length === 0) return '';
  const u = unitFor(primary.drug);
  const label = DRUGS[primary.drug] ? DRUGS[primary.drug].label : primary.drug;
  const preset = TAPER_PRESETS[presetKey] || TAPER_PRESETS['cdc-long'];
  const lines = [`Taper schedule: ${label} ${primary.route} (${preset.label})`, ''];
  schedule.forEach(s => {
    lines.push(`  ${(s.intervalLabel + (s.overshoot ? ' *' : '')).padEnd(16)} ${doseText(s, primary, u).padEnd(22)} ${formatNum(s.mme).padStart(5)} MME (${formatNum(s.pctOfStart)}% of start)`);
  });
  if (schedule.some(s => s.overshoot)) lines.push('  * step larger than planned because of dose rounding; consider holding longer');
  if (schedule.truncated) lines.push('  (endpoint not reached within the schedule shown)');
  lines.push('');
  lines.push(preset.cite);
  lines.push('Reassess pain control, function, and withdrawal symptoms at each step before proceeding.');
  return lines.join('\n');
}
