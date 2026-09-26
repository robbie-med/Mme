// MME calculation + window filtering + numeric formatters.
import { drugUnit, toCanonicalDose } from './drugs.js';
import { getActiveTable, getFactorRange, methadoneFactor, methadonePoEquivalent } from './tables.js';

// Fentanyl patches are worn for 72 hours (FDA label, §2.4 "dosing interval").
export const PATCH_WEAR_HOURS = 72;
const HOUR = 3600 * 1000;

// Entries typed in as a standing regimen (manual, PCA, shared link) carry one
// admin holding the whole daily total. They describe what the patient takes
// per day, so the time window never filters them out. Parsed MAR entries,
// and manual entries whose dose times were edited in the Timeline, carry
// real per-dose timestamps and are windowed.
export function isStandingEntry(entry) {
  return entry.source !== 'parsed' && !entry._timesSet;
}

// Latest real administration time across timed entries, or null. Standing
// entries are excluded: their timestamp is just "when it was typed in", and
// using it as the anchor would push every charted dose out of the window.
export function latestTimedTs(entries) {
  let latest = null;
  entries.forEach(e => {
    if (isStandingEntry(e)) return;
    e.admins.forEach(a => {
      if (Number.isFinite(a.ts) && (latest == null || a.ts > latest)) latest = a.ts;
    });
  });
  return latest;
}

// Window is (anchor − hours, anchor]. The start is exclusive so a dose given
// exactly one window-length before the anchor (e.g. yesterday's once-daily
// dose at the same clock time) is not counted twice.
export function filterAdminsByWindow(admins, windowHours, anchorTs) {
  const valid = admins.filter(a => Number.isFinite(a.ts) && a.ts <= anchorTs);
  if (windowHours === 'all') return valid;
  const start = anchorTs - Number(windowHours) * HOUR;
  return valid.filter(a => a.ts > start);
}

// Observed span for the "all" window: first → last dose plus one median
// dosing interval (so N doses cover N intervals, not N − 1), never less than
// 24 h so less than a day of data is not extrapolated upward.
export function observedSpanHours(admins) {
  if (admins.length < 2) return 24;
  const ts = admins.map(a => a.ts).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const span = (ts[ts.length - 1] - ts[0] + median) / HOUR;
  return Math.max(24, span);
}

function canonicalDose(admin, drug, notes) {
  const d = toCanonicalDose(admin.dose, admin.unit || drugUnit(drug), drug);
  if (d == null) {
    notes.push(`Dose "${admin.dose} ${admin.unit}" has a unit that cannot be converted to ${drugUnit(drug)}; excluded.`);
    return 0;
  }
  return d;
}

// Daily dose + MME for one ledger entry.
//   normalizedDaily: canonical units per day (mcg/hr for patches)
//   mme:     MME/day using the upper factor (what the risk total shows)
//   mmeLow:  MME/day using the lower factor (the basis for conversions)
export function computeEntryMME(entry, windowHours, anchorTs) {
  const drug = entry.drug, route = entry.route;
  const u = drugUnit(drug);
  const isTD = drug === 'fentanyl' && route === 'TD';
  const notes = [];
  let kept, totalDose, normalizedDaily, spanHours = null, basis;

  if (isStandingEntry(entry)) {
    kept = entry.admins.slice();
    totalDose = kept.reduce((s, a) => s + canonicalDose(a, drug, notes), 0);
    normalizedDaily = totalDose;
    basis = 'standing';
  } else if (isTD) {
    // A patch counts from application until 72 h of wear have elapsed; only
    // the most recent application of this order is on the skin.
    const applied = entry.admins.filter(a => Number.isFinite(a.ts) && a.ts <= anchorTs);
    const latest = applied.length ? applied.reduce((a, b) => (a.ts > b.ts ? a : b)) : null;
    if (!latest) {
      kept = [];
      normalizedDaily = 0;
    } else if (anchorTs - latest.ts >= PATCH_WEAR_HOURS * HOUR) {
      kept = [];
      normalizedDaily = 0;
      const h = Math.round((anchorTs - latest.ts) / HOUR);
      notes.push(`Last patch application was ${h} h before the window anchor (beyond the 72 h wear period), so it is counted as removed. Verify whether a patch is still on.`);
    } else {
      kept = [latest];
      normalizedDaily = canonicalDose(latest, drug, notes);
    }
    totalDose = normalizedDaily;
    basis = 'patch';
  } else {
    kept = filterAdminsByWindow(entry.admins, windowHours, anchorTs);
    totalDose = kept.reduce((s, a) => s + canonicalDose(a, drug, notes), 0);
    if (windowHours === 'all') {
      spanHours = observedSpanHours(kept);
      basis = 'all';
    } else {
      spanHours = Number(windowHours);
      basis = 'window';
    }
    normalizedDaily = kept.length ? (totalDose * 24) / spanHours : 0;
  }

  const base = { entry, kept, totalDose, normalizedDaily, spanHours, basis, notes };
  const rg = getFactorRange(drug, route, normalizedDaily);
  if (!rg) {
    return { ...base, mme: null, mmeLow: null, factorLow: null, factorHigh: null,
      factorDescription: 'No conversion factor available' };
  }
  const table = getActiveTable();
  const mme = normalizedDaily * rg.hi;
  const mmeLow = normalizedDaily * rg.lo;
  let factorDescription;
  if (isTD) {
    factorDescription = `${formatNum(normalizedDaily)} mcg/hr × ${formatNum(rg.hi)} MME per mcg/hr (${table.label})`;
  } else if (drug === 'methadone') {
    const po = methadonePoEquivalent(normalizedDaily, route);
    const perPo = methadoneFactor(po);
    const ivStep = route === 'IV'
      ? ` × 2 (IV→oral, methadone label) = ${formatNum(po)} mg/day oral-equivalent` : '';
    factorDescription = `${formatNum(normalizedDaily)} mg/day ${route}${ivStep} × ${perPo} (${table.methadoneTierLabel(po)})`;
  } else if (rg.lo !== rg.hi) {
    factorDescription = `${formatNum(normalizedDaily)} ${u}/day × ${formatNum(rg.hi)} ` +
      `(published range ${formatNum(rg.lo)}–${formatNum(rg.hi)}: total uses ${formatNum(rg.hi)}, conversions use ${formatNum(rg.lo)})`;
  } else {
    factorDescription = `${formatNum(normalizedDaily)} ${u}/day × ${formatNum(rg.hi)} (${table.label})`;
  }
  return { ...base, mme, mmeLow, factorLow: rg.lo, factorHigh: rg.hi, factorDescription };
}

// MME/day (upper factor) for a hypothetical (drug, route, perDose, perDay).
// Used by the before/after preview and the taper table. For patches `dose`
// is the mcg/hr rate and perDay is ignored.
export function previewMME(drug, route, dose, perDay) {
  const isTD = drug === 'fentanyl' && route === 'TD';
  const daily = isTD ? dose : dose * perDay;
  const rg = getFactorRange(drug, route, daily);
  return rg ? daily * rg.hi : 0;
}

export function formatNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  let s = n.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
export function formatDate(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
