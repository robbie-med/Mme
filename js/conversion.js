// Target-opioid conversion: dose math, suggested orders, before/after panel,
// Apply-regimen handler.
//
// Rules, each traceable to a source (README "Sources"):
//  • Convert from the conservative MME basis: the LOWER published factor for
//    each current opioid and the UPPER factor for the target (UofT chart:
//    "use the conversion ratio which provides the most conservative estimate").
//  • Reduce for incomplete cross-tolerance (CDC 2022 Table footnote 3; the
//    Dilaudid injection and hydromorphone ER labels use 50%).
//  • Methadone target: FDA methadone label Table 1 (% of oral MED), low end,
//    capped at 30 mg/day (APS 2014: start no higher than 30–40 mg/day).
//  • Fentanyl patch target: FDA patch label Table 2 (MED bands), opioid-
//    tolerant patients only (≥60 MME/day).
//  • Round every dose DOWN to an available strength (methadone, hydromorphone
//    ER labels: "Always round the dose down").
//  • Never convert away from methadone automatically (methadone label: its
//    conversion table cannot be used in reverse; ratios vary widely).
import { DRUGS } from './drugs.js';
import { getActiveTable, getFactorRange, hasFactor } from './tables.js';
import { previewMME, formatNum } from './mme.js';
import { ledger, addManualEntry } from './ledger.js';
import { getRiskTier } from './safety.js';
import { patientContext } from './settings.js';
import { escapeHtml } from './util.js';
import { ER_LABEL_REF } from './refs.js';

export const OPIOID_TOLERANT_MME = 60;   // FDA patch / ER labels: ≥60 mg oral morphine/day for ≥1 week
export const METHADONE_START_CAP = 30;   // APS 2014: no more than 30–40 mg/day at start

export function floorToStep(n, step) {
  return Math.floor(n / step + 1e-9) * step;
}
export function unitFor(drugKey) { return drugKey === 'fentanyl' ? 'mcg' : 'mg'; }

// Immediate-release / parenteral single-dose increments (smallest practical
// dose and rounding step), from marketed strengths in the product labels.
const PAR = r => ({ IV: r, IM: r, SC: r });
export const IR_FORMS = {
  morphine:      { PO: { step: 2.5, min: 2.5 },  ...PAR({ step: 0.5, min: 1 }) },
  hydromorphone: { PO: { step: 0.5, min: 1 },    ...PAR({ step: 0.1, min: 0.2 }) },
  oxycodone:     { PO: { step: 2.5, min: 2.5 } },
  oxymorphone:   { PO: { step: 2.5, min: 2.5 } },
  hydrocodone:   { PO: { step: 2.5, min: 2.5 } },
  codeine:       { PO: { step: 15,  min: 15 } },
  tramadol:      { PO: { step: 25,  min: 25 } },
  tapentadol:    { PO: { step: 25,  min: 50 } },
};

// Extended-release products: dosing frequency and the strengths that can be
// combined (step/min), per each product's FDA label.
export const ER_FORMS = {
  morphine:      { perDay: 2, step: 15,  min: 15,  interval: 'q12h', src: 'Morphine ER tablets: q8–12h; 15, 30, 60, 100, 200 mg' },
  oxycodone:     { perDay: 2, step: 5,   min: 10,  interval: 'q12h', src: 'OxyContin: q12h; 10–80 mg' },
  oxymorphone:   { perDay: 2, step: 2.5, min: 5,   interval: 'q12h', src: 'Oxymorphone ER: q12h; 5–40 mg' },
  hydromorphone: { perDay: 1, step: 4,   min: 8,   interval: 'once daily', src: 'Hydromorphone ER: once daily, opioid-tolerant only; 8, 12, 16, 32 mg' },
  hydrocodone:   { perDay: 1, step: 10,  min: 20,  interval: 'once daily', src: 'Hysingla ER: once daily; 20–120 mg' },
  tapentadol:    { perDay: 2, step: 50,  min: 50,  interval: 'q12h', max: 500, src: 'Nucynta ER: q12h; 50–250 mg; max 500 mg/day' },
  tramadol:      { perDay: 1, step: 100, min: 100, interval: 'once daily', max: 300, src: 'Tramadol ER: once daily; max 300 mg/day; not for severe renal/hepatic impairment' },
};

// Labeled maximum daily doses for immediate-release targets.
export function irMaxDaily(drugKey, ctx = patientContext) {
  if (drugKey === 'tramadol') {
    if (ctx.renal === 'severe' || ctx.renal === 'dialysis') return { max: 200, why: 'CrCl <30 mL/min: q12h, max 200 mg/day (tramadol label)' };
    if (ctx.age === '75plus') return { max: 300, why: 'age >75: max 300 mg/day (tramadol label)' };
    return { max: 400, why: 'max 400 mg/day (tramadol label)' };
  }
  if (drugKey === 'tapentadol') return { max: 600, why: 'max 600 mg/day after day 1 (Nucynta label)' };
  if (drugKey === 'codeine') return { max: 360, why: 'max 360 mg/24 h (codeine sulfate label)' };
  return null;
}

function intervalLabel(perDay) {
  return ({ 1: 'once daily', 2: 'q12h', 3: 'q8h', 4: 'q6h', 6: 'q4h' })[perDay] || `${perDay}×/day`;
}

// ---------- methadone (FDA label Table 1) ----------

const METHADONE_BANDS = [
  { upTo: 100,      lowPct: 20, highPct: 30, label: '<100 mg' },
  { upTo: 300,      lowPct: 10, highPct: 20, label: '100–300 mg' },
  { upTo: 600,      lowPct: 8,  highPct: 12, label: '300–600 mg' },
  { upTo: 1000,     lowPct: 5,  highPct: 10, label: '600–1,000 mg' },
  { upTo: Infinity, lowPct: null, highPct: 5, label: '>1,000 mg' },
];

// Daily oral methadone for a given oral MED. Uses the low end of the label's
// range; never lower than the previous band gives at its boundary (so the
// result does not drop when MED rises); capped at METHADONE_START_CAP.
export function methadoneFromMED(med) {
  let floorFromPrev = 0;
  for (const b of METHADONE_BANDS) {
    if (med < b.upTo || b.upTo === Infinity) {
      const pct = b.lowPct != null ? b.lowPct : b.highPct;
      const raw = med * pct / 100;
      const dose = Math.min(METHADONE_START_CAP, Math.max(raw, floorFromPrev));
      return {
        daily: dose, band: b, pct, raw, floorFromPrev,
        capped: Math.max(raw, floorFromPrev) > METHADONE_START_CAP,
      };
    }
    floorFromPrev = Math.max(floorFromPrev, b.upTo * b.lowPct / 100);
  }
  return null;
}

// ---------- fentanyl patch (FDA label Table 2) ----------

// Bands: 60–134 → 25, 135–224 → 50, … 1035–1124 → 300 mcg/hr (90 mg steps).
export function patchFromMED(med) {
  if (med < OPIOID_TOLERANT_MME) return { rate: 0, reason: 'not-tolerant' };
  if (med > 1124) return { rate: 0, reason: 'beyond-table' };
  const idx = Math.floor((med - 45) / 90);
  return { rate: 25 * (idx + 1), bandLow: idx === 0 ? 60 : 45 + idx * 90, bandHigh: 134 + idx * 90 };
}
// Combination of marketed systems (12, 25, 37.5, 50, 62.5, 75, 100 mcg/hr).
export function patchComposition(rate) {
  const parts = [];
  let left = rate;
  while (left >= 100) { parts.push(100); left -= 100; }
  for (const s of [75, 62.5, 50, 37.5, 25, 12.5]) {
    if (left >= s - 1e-9) { parts.push(s); left -= s; }
  }
  return parts.map(p => (p === 12.5 ? '12' : formatNum(p))).join(' + ');
}

// ---------- main entry ----------

// rows: output of computeEntryMME for every ledger entry.
// target: 'drug|ROUTE'. reductionPct: 0–100.
export function computeConversion(rows, target, reductionPct, ctx = patientContext) {
  const [drug, route] = String(target || '').split('|');
  if (!DRUGS[drug] || !hasFactor(drug, route)) return null;
  const label = DRUGS[drug].label;
  const table = getActiveTable();
  const counted = rows.filter(r => r.mme != null && r.mme > 0);
  const excluded = rows.filter(r => r.mme == null).map(r => `${DRUGS[r.entry.drug] ? DRUGS[r.entry.drug].label : r.entry.drug} ${r.entry.route}`);
  const riskMME = counted.reduce((s, r) => s + r.mme, 0);
  const basisMME = counted.reduce((s, r) => s + r.mmeLow, 0);
  const warnings = [];
  const notes = [];
  const steps = [];

  if (excluded.length) warnings.push(`Not included (no MME factor): ${excluded.join(', ')}.`);

  steps.push({ k: 'Current total', v: `${formatNum(riskMME)} MME/day (${table.label})` });
  if (Math.abs(basisMME - riskMME) > 1e-6) {
    const ranged = Array.from(new Set(counted.filter(r => r.factorLow !== r.factorHigh)
      .map(r => `${DRUGS[r.entry.drug].label} ${r.entry.route} × ${formatNum(r.factorLow)}`))).join(', ');
    steps.push({ k: 'Conversion basis', v: `${formatNum(basisMME)} MME/day using the lower published factor (${ranged})` });
  }

  const fromMethadone = counted.some(r => r.entry.drug === 'methadone');
  const fromPatch = counted.some(r => r.entry.drug === 'fentanyl' && r.entry.route === 'TD');
  const sameDrugOnly = counted.length > 0 && counted.every(r => r.entry.drug === drug);
  let blocked = null;
  if (fromMethadone && drug !== 'methadone') {
    blocked = 'Converting away from methadone has no validated ratio. The methadone label states its conversion table cannot be used in reverse and that the ratio "may vary widely as a function of previous dose exposure." Obtain pain or palliative specialist input.';
  }
  if (fromPatch) {
    notes.push('Converting from a fentanyl patch: serum fentanyl falls only ~50% in 20–27 h after removal (patch label). The hydromorphone ER label starts the new opioid 18 h after patch removal and reduces its calculated dose by 50%.');
  }

  // Reference keys (js/refs.js) for everything this conversion relies on.
  const refs = [...(table.refs || [])];
  if (counted.some(r => r.factorLow !== r.factorHigh)) refs.push('uoft');
  if (fromMethadone) refs.push('lblMethadone');
  if (fromPatch) refs.push('lblFentanylTD', 'lblHydromorphER');
  const out = { drug, route, label, table: table.label, riskMME, basisMME, steps, warnings, notes, blocked, refs };

  // --- Methadone target ---
  if (drug === 'methadone') {
    if (route !== 'PO') return { ...out, error: 'Only oral methadone is supported as a target.' };
    const m = methadoneFromMED(basisMME);
    out.method = 'methadone-label';
    refs.push('lblMethadone', 'aps2014', 'cdc2022');
    out.reductionApplied = 0;
    const b = m.band;
    steps.push({ k: 'Methadone label Table 1', v: `oral MED ${b.label} → ${b.lowPct != null ? `${b.lowPct}–${b.highPct}%` : `<${b.highPct}%`} of MED; low end ${m.pct}% × ${formatNum(basisMME)} = ${formatNum(m.raw)} mg/day` });
    if (m.floorFromPrev > m.raw) {
      steps.push({ k: 'Kept monotonic', v: `raised to ${formatNum(m.floorFromPrev)} mg/day, the lower band's value at its upper boundary, so a higher MED never yields a lower dose` });
    }
    if (m.capped) steps.push({ k: 'Start cap', v: `capped at ${METHADONE_START_CAP} mg/day (APS 2014: start no higher than 30–40 mg/day)` });
    notes.push('The label percentages already account for incomplete cross-tolerance, so the cross-tolerance reduction selector is not applied.');
    out.calculatedDaily = m.daily;
    out.unitDaily = 'mg/day PO';
    out.orders = methadoneOrders(m.daily);
  // --- Fentanyl patch target ---
  } else if (drug === 'fentanyl' && route === 'TD') {
    const p = patchFromMED(basisMME);
    out.method = 'patch-label';
    refs.push('lblFentanylTD');
    out.reductionApplied = 0;
    if (p.reason === 'not-tolerant') {
      return { ...out, blocked: `Fentanyl patches are contraindicated in patients who are not opioid-tolerant (<${OPIOID_TOLERANT_MME} mg oral morphine/day for ≥1 week; patch label). Current conversion basis is ${formatNum(basisMME)} MME/day.`, orders: null };
    }
    if (p.reason === 'beyond-table') {
      return { ...out, blocked: 'Above the label conversion table (>1,124 mg/day oral morphine). Specialist input required.', orders: null };
    }
    steps.push({ k: 'Patch label Table 2', v: `oral MED ${p.bandLow}–${p.bandHigh} mg/day → ${p.rate} mcg/hr` });
    notes.push('Label Table 2 is already conservative, so the cross-tolerance reduction selector is not applied. Do not use it in reverse.');
    out.calculatedDaily = p.rate;
    out.unitDaily = 'mcg/hr patch';
    out.orders = patchOrders(p.rate);
  // --- Everything else: factor math ---
  } else {
    const red = Math.max(0, Math.min(100, Number(reductionPct) || 0));
    const adj = basisMME * (1 - red / 100);
    const tf = getFactorRange(drug, route, 0);
    out.method = 'factor';
    refs.push('cdc2022', 'lblDilaudidInj', 'lblHydromorphER');
    if (tf.lo !== tf.hi) refs.push('uoft');
    out.reductionApplied = red;
    steps.push({ k: 'Cross-tolerance', v: red > 0 ? `− ${red}% → ${formatNum(adj)} MME/day` : 'none applied (CDC advises a substantially lower dose than the calculated MME)' });
    const tfDesc = tf.lo !== tf.hi ? `${formatNum(tf.hi)} (upper of ${formatNum(tf.lo)}–${formatNum(tf.hi)}, the conservative choice for a target)` : formatNum(tf.hi);
    const u = unitFor(drug);
    const daily = adj / tf.hi;
    steps.push({ k: `÷ ${label} ${route} factor`, v: `${formatNum(adj)} ÷ ${tfDesc} = ${formatNum(daily)} ${u}/day` });
    if (sameDrugOnly && red > 0) notes.push(`Current regimen is already ${label}; for a formulation or schedule change of the same opioid a cross-tolerance reduction may not be needed. Check the product label.`);
    out.calculatedDaily = daily;
    out.unitDaily = `${u}/day ${route}`;
    if (drug === 'fentanyl') out.orders = fentanylInfusionOrders(daily);
    else out.orders = factorOrders(drug, route, daily, basisMME, ctx);
  }

  if (out.orders && out.orders.refs) refs.push(...out.orders.refs);
  if (blocked) out.orders = null;
  if (out.orders && out.orders.primary) {
    const p = out.orders.primary;
    out.projectedMME = previewMME(p.drug, p.route, p.dose, p.perDay);
    out.orderedDaily = p.drug === 'fentanyl' && p.route === 'TD' ? p.dose : p.dose * p.perDay;
  }
  return out;
}

function methadoneOrders(daily) {
  // Label: divide by the schedule (q8h → ÷3) and round DOWN to available
  // strength. Half of a scored 5 mg tablet = 2.5 mg.
  let perDay = 3;
  let per = floorToStep(daily / 3, 2.5);
  const notes = [
    'Steady state takes at least 3–5 days; titrate no more often than every 3–5 days, and some patients need up to 12 days between increases (methadone label).',
    'Assess QT-prolongation risk and consider ECG monitoring (CDC 2022 Rec 3).',
    'Highly variable kinetics; pain or palliative specialist input strongly advised.',
  ];
  const warnings = [];
  if (per < 2.5) {
    perDay = 2;
    per = floorToStep(daily / 2, 2.5);
  }
  if (per < 2.5) {
    per = 2.5;
    warnings.push(`Calculated ${formatNum(daily)} mg/day is below 2.5 mg q12h, the label's lowest starting dose; that dose is shown and exceeds the calculation.`);
  }
  return {
    scheduled: [`${formatNum(per)} mg methadone PO ${intervalLabel(perDay)}`],
    breakthrough: 'Use a separate immediate-release opioid for breakthrough pain; do not use methadone PRN.',
    notes, warnings,
    primary: { drug: 'methadone', route: 'PO', dose: per, perDay },
    refs: ['lblMethadone', 'cdc2022'],
  };
}

function patchOrders(rate) {
  const patchMME = rate * 2.4;
  const bt = breakthroughRange('morphine', 'PO', patchMME);
  return {
    scheduled: [`${formatNum(rate)} mcg/hr fentanyl patch q72h (${patchComposition(rate)} mcg/hr system${rate > 100 ? 's' : ''})`],
    breakthrough: bt ? `${bt} morphine IR PO PRN (10–20% of the patch's ${formatNum(patchMME)} MME/day), or an equivalent immediate-release opioid` : 'Immediate-release opioid PRN per clinician',
    notes: [
      'Opioid-tolerant patients only. Discontinue or taper other extended-release opioids when starting (patch label).',
      'Do not increase before 3 days; steady state can take 6 days. Titrate by 12 mcg/hr per 45 mg/day of oral morphine rescue used (patch label).',
      'Fever or external heat increases absorption and overdose risk.',
    ],
    warnings: [],
    primary: { drug: 'fentanyl', route: 'TD', dose: rate, perDay: 1 },
    refs: ['lblFentanylTD', 'myers2008'],
  };
}

function fentanylInfusionOrders(dailyMcg) {
  const rate = floorToStep(dailyMcg / 24, 5);
  if (rate < 5) {
    return {
      scheduled: [`Calculated ${formatNum(dailyMcg / 24)} mcg/hr is below a practical infusion rate (5 mcg/hr); use intermittent dosing instead.`],
      breakthrough: 'Per institutional protocol', notes: [], warnings: [], primary: null,
    };
  }
  return {
    scheduled: [`Fentanyl continuous infusion ${rate} mcg/hr (rounded down from ${formatNum(dailyMcg / 24)})`],
    breakthrough: 'Bolus dosing per institutional infusion protocol, with continuous monitoring',
    notes: ['Use a monitored setting. The IV fentanyl factor is uncertain (0.1–0.3 MME/mcg); the upper value is used here so the rate is on the low side.'],
    warnings: [],
    primary: { drug: 'fentanyl', route: 'IV', dose: rate, perDay: 24 },
    refs: ['uoft', 'cms2017'],
  };
}

// 10–20% of the total daily dose (Myers & Shetty, Curr Oncol 2008;15 Suppl 1:S41–9), as the
// IR form of the given drug/route, rounded down. Returns a string or null.
function breakthroughRange(drug, route, dailyMMEorDose, isMME = true) {
  const form = (IR_FORMS[drug] || {})[route];
  if (!form) return null;
  const rg = getFactorRange(drug, route, 0);
  const daily = isMME ? dailyMMEorDose / rg.hi : dailyMMEorDose;
  const lo = floorToStep(daily * 0.10, form.step);
  const hi = floorToStep(daily * 0.20, form.step);
  const u = unitFor(drug);
  if (hi < form.min) return null;
  const loD = Math.max(lo, form.min);
  return loD >= hi ? `${formatNum(hi)} ${u}` : `${formatNum(loD)}–${formatNum(hi)} ${u}`;
}

function factorOrders(drug, route, daily, basisMME, ctx) {
  const label = DRUGS[drug].label;
  const u = unitFor(drug);
  const form = (IR_FORMS[drug] || {})[route];
  const scheduled = [];
  const notes = [];
  const warnings = [];
  const refs = ['myers2008'];
  let primary = null;

  // Apply labeled maximums to the daily amount we schedule.
  let schedDaily = daily;
  const irMax = irMaxDaily(drug, ctx);
  if (irMax && daily > irMax.max) {
    warnings.push(`Calculated ${formatNum(daily)} ${u}/day exceeds the labeled maximum (${irMax.why}). Orders are capped at ${irMax.max} ${u}/day, which is LESS than the calculated equivalent; ${label} is a poor target at this MME.`);
    schedDaily = irMax.max;
  }
  if (irMax) refs.push({ tramadol: 'lblTramadol', tapentadol: 'lblNucynta', codeine: 'lblCodeine' }[drug]);

  // Extended-release option: opioid-tolerant patients only (conservative
  // reading of the ER labels and CDC Rec 3).
  const er = route === 'PO' ? ER_FORMS[drug] : null;
  let erLine = null;
  if (er) {
    let erDaily = schedDaily;
    if (er.max && erDaily > er.max) erDaily = er.max;
    const per = floorToStep(erDaily / er.perDay, er.step);
    const renalBlock = drug === 'tramadol' && (ctx.renal === 'severe' || ctx.renal === 'dialysis' || ctx.hepatic === 'severe');
    if (basisMME < OPIOID_TOLERANT_MME) {
      notes.push(`ER ${label} not suggested: extended-release opioids are for opioid-tolerant patients (≥60 MME/day for ≥1 week); current basis ${formatNum(basisMME)}.`);
    } else if (renalBlock) {
      notes.push('Tramadol ER not suggested: its label advises against use in severe renal or hepatic impairment.');
    } else if (per >= er.min) {
      erLine = `${formatNum(per)} ${u} ${label} ER PO ${er.interval}`;
      scheduled.push(erLine);
      primary = { drug, route: 'PO', dose: per, perDay: er.perDay, er: true };
      notes.push(`ER product: ${er.src}.`);
      refs.push(ER_LABEL_REF[drug]);
    }
  }

  // Immediate-release / parenteral scheduled option: longest practical
  // interval where the rounded-down dose is at least the smallest dose.
  if (form) {
    const renalTramadol = drug === 'tramadol' && (ctx.renal === 'severe' || ctx.renal === 'dialysis');
    const options = renalTramadol ? [2] : [6, 4, 3];
    let chosen = null;
    for (const n of options) {
      const per = floorToStep(schedDaily / n, form.step);
      if (per >= form.min) { chosen = { n, per }; break; }
    }
    if (chosen) {
      const where = route === 'PO' ? 'IR PO' : route;
      scheduled.push(`${formatNum(chosen.per)} ${u} ${label} ${where} ${intervalLabel(chosen.n)} scheduled`);
      if (!primary) primary = { drug, route, dose: chosen.per, perDay: chosen.n };
    } else {
      scheduled.push(`Calculated ${formatNum(daily)} ${u}/day is below the smallest practical scheduled dose (${form.min} ${u} ${intervalLabel(options[options.length - 1])}); use PRN dosing only.`);
    }
  }

  const bt = breakthroughRange(drug, route, daily, false);
  const where = route === 'PO' ? 'IR PO' : route;
  const breakthrough = bt
    ? `${bt} ${label} ${where} PRN (10–20% of the daily dose)`
    : `Below the smallest ${label} ${where} dose; choose a lower-potency rescue opioid.`;
  notes.push('Rescue doses of 10–20% of the total daily dose (Curr Oncol 2008). Set the PRN interval per institutional policy.');
  if (drug === 'hydrocodone' || drug === 'oxycodone' || drug === 'codeine' || drug === 'tramadol') {
    notes.push('If an acetaminophen combination product is used, keep total acetaminophen ≤4,000 mg/day across all products (combination-product labels; CDC 2022 Rec 4).');
    refs.push('lblHydrocodoneApap', 'cdc2022');
  }
  if (drug === 'hydromorphone' && route !== 'PO') {
    notes.push('Hydromorphone injection label: when converting from another opioid, reduce the calculated dose by one-half; IV starting doses 0.2–1 mg.');
    refs.push('lblDilaudidInj');
  }
  if (drug === 'tramadol' && (ctx.renal === 'severe' || ctx.renal === 'dialysis' || ctx.age === '75plus')) refs.push('lblTramadol');
  return { scheduled, breakthrough, notes, warnings, primary, refs };
}

// ---------- rendering ----------

export function renderConversionOrders(orders) {
  if (!orders) return '';
  const warn = orders.warnings && orders.warnings.length
    ? `<div class="conv-warnings">${orders.warnings.map(w => `<div class="conv-warning">${escapeHtml(w)}</div>`).join('')}</div>` : '';
  return `
    <div class="conv-orders">
      <h4>Suggested orders</h4>
      ${warn}
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

function describePrimary(p) {
  const u = unitFor(p.drug);
  const drugLabel = DRUGS[p.drug].label;
  if (p.drug === 'fentanyl' && p.route === 'TD') return `${formatNum(p.dose)} mcg/hr patch`;
  if (p.drug === 'fentanyl' && p.route === 'IV') return `${formatNum(p.dose)} mcg/hr continuous (× 24 h)`;
  if (p.er) return `${formatNum(p.dose)} ${u} ${drugLabel} ER PO ${intervalLabel(p.perDay)}`;
  const where = p.route === 'PO' ? 'IR PO' : p.route;
  return `${formatNum(p.dose)} ${u} ${drugLabel} ${where} ${intervalLabel(p.perDay)} scheduled`;
}

export function buildBeforeAfter(currentRows, currentTotal, conv) {
  const orders = conv && conv.orders;
  if (!orders || !orders.primary) return '';
  const p = orders.primary;
  const projectedMME = previewMME(p.drug, p.route, p.dose, p.perDay);
  const currentTier = getRiskTier(currentTotal);
  const projectedTier = getRiskTier(projectedMME);

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
      <span class="cmp-name">${escapeHtml(describePrimary(p))}</span>
      <span class="cmp-mme">${formatNum(projectedMME)} MME</span>
    </div>
    <div class="cmp-row cmp-prn">
      <span class="cmp-name">+ PRN: ${escapeHtml(orders.breakthrough)}</span>
      <span class="cmp-mme">as-needed</span>
    </div>`;

  const deltaMME = projectedMME - currentTotal;
  const pct = currentTotal > 0 ? Math.round((deltaMME / currentTotal) * 100) : 0;
  const deltaStr = Math.abs(deltaMME) < 1e-9 ? '±0' : `${deltaMME > 0 ? '+' : ''}${formatNum(deltaMME)}, ${pct > 0 ? '+' : ''}${pct}%`;
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
