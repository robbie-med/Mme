// Target-opioid conversion: dose math, suggested orders, before/after panel,
// Apply-regimen handler. The renderConversion fn is in render.js; this module
// owns the data + HTML for the orders/comparison panel.
import { DRUGS } from './drugs.js';
import { getActiveTable, getFactor, methadoneOutFactor } from './tables.js';
import { previewMME, formatNum } from './mme.js';
import { ledger, addManualEntry } from './ledger.js';
import { getRiskTier } from './safety.js';
import { escapeHtml } from './util.js';

export function roundToStep(n, step) { return Math.round(n / step) * step; }

// Per-drug clinically reasonable rounding for a single dose.
export function roundSingleDose(n, drugKey) {
  if (n < 0) return 0;
  if (drugKey === 'fentanyl') return Math.max(1, Math.round(n));
  if (drugKey === 'hydromorphone') return Math.max(0.5, roundToStep(n, 0.5));
  if (drugKey === 'oxymorphone')   return Math.max(2.5, roundToStep(n, 2.5));
  if (drugKey === 'oxycodone')     return Math.max(2.5, roundToStep(n, 2.5));
  if (drugKey === 'methadone')     return Math.max(2.5, roundToStep(n, 2.5));
  if (drugKey === 'tramadol')      return Math.max(25, roundToStep(n, 25));
  if (drugKey === 'tapentadol')    return Math.max(25, roundToStep(n, 25));
  if (drugKey === 'codeine')       return Math.max(15, roundToStep(n, 15));
  return Math.max(5, roundToStep(n, 5));
}

export function unitFor(drugKey) { return drugKey === 'fentanyl' ? 'mcg' : 'mg'; }

export const HAS_ER = new Set(['morphine', 'oxycodone', 'hydromorphone', 'oxymorphone', 'tramadol', 'tapentadol']);

function breakthroughLine(drugKey, route, dailyDose) {
  const u = unitFor(drugKey);
  const minD = roundSingleDose(dailyDose * 0.10, drugKey);
  const maxD = roundSingleDose(dailyDose * 0.20, drugKey);
  const label = DRUGS[drugKey].label;
  const form = route === 'PO' ? 'IR PO' : route;
  if (minD === maxD || minD === 0) return `~${maxD} ${u} ${label} ${form} q4h PRN (~15% of daily)`;
  return `${minD}–${maxD} ${u} ${label} ${form} q4h PRN (10–20% of daily)`;
}

export function buildConversionOrders(drugKey, route, dose, adjMME) {
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
      primary: { drug: 'methadone', route: 'PO', dose: per, perDay: 3 },
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
      primary: { drug: 'fentanyl', route: 'TD', dose: conservative, perDay: 1 },
    };
  }

  if (drugKey === 'fentanyl' && route === 'IV') {
    const rate = Math.max(5, roundToStep(dose / 24, 5));
    return {
      scheduled: [`Continuous infusion ~${rate} mcg/hr (titrate to effect)`],
      breakthrough: '25–50 mcg IV bolus q15min PRN, then adjust basal rate',
      notes: ['Use monitored setting; rapid bolus risks chest-wall rigidity at higher doses.'],
      primary: { drug: 'fentanyl', route: 'IV', dose: rate, perDay: 24 },
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
      primary: HAS_ER.has(drugKey)
        ? { drug: drugKey, route: 'PO', dose: erDose, perDay: 2 }
        : { drug: drugKey, route: 'PO', dose: irDose, perDay: 6 },
    };
  }

  // Parenteral (IV/IM/SC)
  const perDose = roundSingleDose(dose / 6, drugKey);
  return {
    scheduled: [`${perDose} ${u} ${label} ${route} q4h scheduled (or PCA basal/demand)`],
    breakthrough: breakthroughLine(drugKey, route, dose),
    notes: [],
    primary: { drug: drugKey, route, dose: perDose, perDay: 6 },
  };
}

export function renderConversionOrders(orders) {
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

function perDayToInterval(n) {
  return n === 1 ? 'daily' : n === 2 ? 'BID' : n === 3 ? 'TID' : n === 4 ? 'QID' : n === 6 ? 'q4h' : `${n}×/day`;
}

export function buildBeforeAfter(currentRows, currentTotal, orders) {
  if (!orders || !orders.primary) return '';
  const p = orders.primary;
  const projectedMME = previewMME(p.drug, p.route, p.dose, p.perDay);
  const currentTier = getRiskTier(currentTotal);
  const projectedTier = getRiskTier(projectedMME);

  const u = unitFor(p.drug);
  const drugLabel = DRUGS[p.drug].label;
  let primaryDescr;
  if (p.drug === 'fentanyl' && p.route === 'TD') {
    primaryDescr = `${formatNum(p.dose)} mcg/hr patch`;
  } else if (p.drug === 'fentanyl' && p.route === 'IV') {
    primaryDescr = `${formatNum(p.dose)} mcg/hr continuous (× 24 h)`;
  } else if (p.drug === 'methadone' && p.route === 'PO') {
    primaryDescr = `${formatNum(p.dose)} mg PO TID`;
  } else if (p.route === 'PO') {
    primaryDescr = p.perDay === 2
      ? `${formatNum(p.dose)} ${u} ${drugLabel} ER PO BID`
      : `${formatNum(p.dose)} ${u} ${drugLabel} IR PO ${perDayToInterval(p.perDay)} scheduled`;
  } else {
    primaryDescr = `${formatNum(p.dose)} ${u} ${drugLabel} ${p.route} ${perDayToInterval(p.perDay)} scheduled`;
  }

  const currentList = currentRows.length
    ? currentRows.map(r => {
        const drug = DRUGS[r.entry.drug] ? DRUGS[r.entry.drug].label : r.entry.drug;
        return `<div class="cmp-row">
          <span class="cmp-name">${escapeHtml(drug)} ${escapeHtml(r.entry.route)}</span>
          <span class="cmp-mme">${r.mme == null ? '—' : formatNum(r.mme)} MME</span>
        </div>`;
      }).join('')
    : '<div class="cmp-row cmp-empty">No medications</div>';

  const projList = `
    <div class="cmp-row">
      <span class="cmp-name">${escapeHtml(primaryDescr)}</span>
      <span class="cmp-mme">${formatNum(projectedMME)} MME</span>
    </div>
    <div class="cmp-row cmp-prn">
      <span class="cmp-name">+ PRN: ${escapeHtml(orders.breakthrough)}</span>
      <span class="cmp-mme">as-needed</span>
    </div>`;

  const deltaMME = projectedMME - currentTotal;
  const deltaStr = deltaMME === 0 ? '±0' : (deltaMME > 0 ? '+' : '') + formatNum(deltaMME);
  const deltaClass = deltaMME < 0 ? 'cmp-delta-down' : deltaMME > 0 ? 'cmp-delta-up' : '';

  return `
    <div class="conv-compare">
      <div class="cmp-side cmp-current">
        <div class="cmp-title">Current</div>
        <div class="cmp-meds">${currentList}</div>
        <div class="cmp-foot">
          <span class="cmp-total"><strong>${formatNum(currentTotal)}</strong> MME/day</span>
          <span class="risk-badge risk-${currentTier.level}">${currentTier.label}</span>
        </div>
      </div>
      <div class="cmp-arrow" aria-hidden="true">→</div>
      <div class="cmp-side cmp-projected">
        <div class="cmp-title">Proposed (scheduled)</div>
        <div class="cmp-meds">${projList}</div>
        <div class="cmp-foot">
          <span class="cmp-total"><strong>${formatNum(projectedMME)}</strong> MME/day <span class="${deltaClass}">(${deltaStr})</span></span>
          <span class="risk-badge risk-${projectedTier.level}">${projectedTier.label}</span>
        </div>
        <button type="button" class="ghost cmp-apply" id="apply-regimen-btn"
          data-drug="${escapeHtml(p.drug)}" data-route="${escapeHtml(p.route)}"
          data-dose="${p.dose}" data-perday="${p.perDay}">
          Apply this regimen
        </button>
      </div>
    </div>`;
}

export function applyProposedRegimen(drug, route, dose, perDay) {
  if (!confirm(`Replace your current regimen with: ${drug} ${route} ${dose} × ${perDay}/day?\n\nYour current medications will be removed from the list.`)) return;
  // Clear the target BEFORE mutating the ledger so that addManualEntry's
  // notify-driven render sees the empty target and hides the conversion
  // panel (and the URL hash drops t=) in a single pass.
  const targetSel = document.getElementById('target-drug');
  if (targetSel) targetSel.value = '';
  ledger.length = 0;
  addManualEntry({ drug, route, dose: Number(dose), perDay: Number(perDay) });
}

// Dose math used by both renderConversion and the export-as-note formatter.
export function computeTargetDose(drugKey, route, adjMME) {
  if (drugKey === 'methadone' && route === 'PO') {
    const ratio = methadoneOutFactor(adjMME);
    return {
      dose: adjMME / ratio,
      unit: 'mg/day PO',
      // calcDesc names the active table; renderConversion uses it as-is.
      calcDesc: `${formatNum(adjMME)} MME ÷ ${ratio} (${getActiveTable().label} methadone ratio)`,
      ratio,
    };
  }
  if (drugKey === 'fentanyl' && route === 'TD') {
    const f = getFactor('fentanyl', 'TD');
    return { dose: adjMME / f, unit: 'mcg/hr patch', calcDesc: `${formatNum(adjMME)} MME ÷ ${f} MME per mcg/hr-day` };
  }
  if (drugKey === 'fentanyl' && route === 'IV') {
    const f = getFactor('fentanyl', 'IV');
    return { dose: adjMME / f, unit: 'mcg/day IV', calcDesc: `${formatNum(adjMME)} MME ÷ ${f} MME per mcg` };
  }
  const factor = getFactor(drugKey, route);
  if (typeof factor !== 'number') return null;
  return { dose: adjMME / factor, unit: `mg/day ${route}`, calcDesc: `${formatNum(adjMME)} MME ÷ ${factor}` };
}
