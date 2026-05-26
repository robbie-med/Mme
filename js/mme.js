// MME calculation + window filtering + numeric formatters.
import { drugUnit } from './drugs.js';
import { getActiveTable, getFactor, methadoneInFactor } from './tables.js';

export function filterAdminsByWindow(admins, windowHours, anchorTs) {
  if (admins.length === 0) return { kept: [], mode: 'window' };
  if (windowHours === 'all') return { kept: admins.slice(), mode: 'all' };
  const hrs = Number(windowHours);
  const start = anchorTs - hrs * 3600 * 1000;
  return { kept: admins.filter(a => a.ts >= start && a.ts <= anchorTs), mode: 'window' };
}

export function computeEntryMME(entry, windowHours, anchorTs) {
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

// MME for a hypothetical (drug, route, perDose, perDay) without touching the
// ledger — used by the before/after preview.
export function previewMME(drug, route, dose, perDay) {
  const isTD = drug === 'fentanyl' && route === 'TD';
  const dailyDose = isTD ? dose : dose * perDay;
  if (drug === 'methadone' && route === 'PO') {
    return dailyDose * methadoneInFactor(dailyDose);
  }
  if (isTD) return dose * getFactor('fentanyl', 'TD');
  const factor = getFactor(drug, route);
  return typeof factor === 'number' ? dailyDose * factor : 0;
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
