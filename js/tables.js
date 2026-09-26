// Equianalgesic-table registry. Every number here is traceable to a cited
// source (see SOURCES below and README "Sources"). At runtime the active
// table is looked up via settings.activeTable.
//
// A factor is MME per unit of drug (mg, or mcg for fentanyl; mcg/hr for
// transdermal fentanyl). It is either a single number or a { lo, hi } range
// when published equianalgesic data disagree. The MME total (risk) uses `hi`;
// conversions use `lo` for the drugs being converted FROM and `hi` for the
// drug being converted TO, i.e. "use the conversion ratio which provides the
// most conservative estimate" (UofT equianalgesic chart, note).
import { settings } from './settings.js';

export const SOURCES = {
  cdc2022: 'Dowell D, et al. CDC Clinical Practice Guideline for Prescribing Opioids for Pain, United States, 2022. MMWR Recomm Rep 2022;71(No. RR-3), Table.',
  cms2017: 'CMS/CDC Opioid Oral MME Conversion Factors (CDC compilation, 2017 version), incl. graduated methadone factors used by the CMS Overutilization Monitoring System.',
  uoft:    'University of Toronto Dept. of Surgery, Opioid Equianalgesic Table (Nov 2014): parenteral 10 mg morphine = 20–30 mg oral; hydromorphone 1.5 mg; meperidine 75 mg; fentanyl 100 mcg; codeine 120 mg (SC/IM, not IV).',
  methadoneLabel: 'Methadone HCl tablets, FDA prescribing information §2.4: parenteral-to-oral methadone ratio 1:2; Table 1 conversion to methadone.',
  nalbuphineLabel: 'Nalbuphine HCl injection, FDA prescribing information: analgesic potency essentially equivalent to morphine on a mg basis (up to ~30 mg).',
};

// Parenteral (IV / IM / SC) factors are not in the CDC or CMS tables, which
// cover oral and transdermal products. They are anchored to the UofT chart:
// parenteral morphine 10 mg = oral morphine 20–30 mg, so 1 mg parenteral
// morphine = 2–3 MME. Other parenteral opioids are scaled from their
// equianalgesic dose relative to parenteral morphine 10 mg.
const r = (lo, hi) => ({ lo, hi });
const MORPHINE_PAR = r(2, 3);                          // 10 mg IV ≈ 20–30 mg PO
const HYDROMORPHONE_PAR = r(10 / 1.5 * 2, 10 / 1.5 * 3); // 1.5 mg ≈ 10 mg IV morphine → 13.3–20
const MEPERIDINE_PAR = r(10 / 75 * 2, 10 / 75 * 3);    // 75 mg ≈ 10 mg IV morphine → 0.27–0.4
const CODEINE_PAR = r(10 / 120 * 2, 10 / 120 * 3);     // 120 mg SC/IM ≈ 10 mg → 0.17–0.25
// Fentanyl parenteral: 100 mcg ≈ 10 mg IV morphine (UofT) → 0.2–0.3 MME/mcg.
// CMS footnote vii instead assumes 1 mg parenteral fentanyl = 100 mg oral
// morphine (0.1 MME/mcg), the ratio behind the 2.4 transdermal factor. The
// range spans both so conversions stay conservative in either direction.
const FENTANYL_PAR = r(0.1, 0.3);

function parenteral(v) { return { IV: v, IM: v, SC: v }; }

// Shared entries (identical in every table).
const COMMON = {
  morphine:      { PO: 1, ...parenteral(MORPHINE_PAR) },
  oxycodone:     { PO: 1.5 },
  oxymorphone:   { PO: 3 },
  hydrocodone:   { PO: 1 },
  codeine:       { PO: 0.15, IM: CODEINE_PAR, SC: CODEINE_PAR },
  tapentadol:    { PO: 0.4 },
  // CMS 2017 (not listed in the CDC 2022 table):
  meperidine:    { PO: 0.1, ...parenteral(MEPERIDINE_PAR) },
  levorphanol:   { PO: 11 },
  // CMS lists butorphanol 7 per mg without a formulation; the US outpatient
  // product is the nasal spray, so only that route is offered.
  butorphanol:   { NS: 7 },
  // Transdermal 2.4 per mcg/hr (CDC 2022; CMS 7.2 is the same factor × 3 days
  // of wear for claims data). Buccal/SL/lozenge 0.13 per mcg (CMS 2017).
  fentanyl:      { ...parenteral(FENTANYL_PAR), TD: 2.4, SL: 0.13 },
  // Mixed agonist-antagonist: mg-for-mg with parenteral morphine (label).
  nalbuphine:    parenteral(MORPHINE_PAR),
  // Partial agonist: excluded from MME by CDC 2022 (footnote 6) and CMS.
  buprenorphine: {},
};

export const TABLES = {
  cdc: {
    label: 'CDC 2022',
    cite: SOURCES.cdc2022,
    // CMS supplies the drugs the CDC table omits (meperidine, levorphanol, …).
    refs: ['cdc2022', 'cms2017'],
    factors: {
      ...COMMON,
      hydromorphone: { PO: 5, ...parenteral(HYDROMORPHONE_PAR) },
      tramadol:      { PO: 0.2 },
      methadone:     { PO: 'methadone', IV: 'methadone' },
    },
    // CDC 2022 uses a single methadone factor.
    methadoneFactor(_dailyPoMg) { return 4.7; },
    methadoneTierLabel(_dailyPoMg) { return 'CDC 2022 single factor'; },
  },
  cms: {
    label: 'CMS 2017 (graduated methadone)',
    cite: SOURCES.cms2017,
    refs: ['cms2017'],
    factors: {
      ...COMMON,
      hydromorphone: { PO: 4, ...parenteral(HYDROMORPHONE_PAR) },
      tramadol:      { PO: 0.1 },
      methadone:     { PO: 'methadone', IV: 'methadone' },
    },
    methadoneFactor(dailyPoMg) {
      if (dailyPoMg <= 20) return 4;
      if (dailyPoMg <= 40) return 8;
      if (dailyPoMg <= 60) return 10;
      return 12;
    },
    methadoneTierLabel(dailyPoMg) {
      if (dailyPoMg <= 20) return 'CMS tier >0–20 mg/day';
      if (dailyPoMg <= 40) return 'CMS tier >20–40 mg/day';
      if (dailyPoMg <= 60) return 'CMS tier >40–60 mg/day';
      return 'CMS tier >60 mg/day';
    },
  },
};

export const DEFAULT_TABLE = 'cdc';
// Older shared links / saved settings may name tables that were removed
// because their factors could not be traced to a published source.
export function resolveTableKey(key) { return TABLES[key] ? key : DEFAULT_TABLE; }

export function getActiveTable() {
  return TABLES[resolveTableKey(settings.activeTable)];
}

function rawFactor(drug, route) {
  const f = getActiveTable().factors[drug];
  return f ? f[route] : undefined;
}

// Methadone: IV mg are converted to oral-equivalent mg (1:2, methadone label)
// before applying the table's oral factor, so tiers stay consistent.
export function methadonePoEquivalent(dailyMg, route) {
  return route === 'IV' ? dailyMg * 2 : dailyMg;
}
export function methadoneFactor(dailyPoMg) { return getActiveTable().methadoneFactor(dailyPoMg); }

// { lo, hi } factor for a (drug, route), or null when no factor exists.
// Methadone returns the effective factor per mg of the given route at the
// given daily dose (needed because CMS tiers depend on daily dose).
export function getFactorRange(drug, route, dailyDose) {
  const f = rawFactor(drug, route);
  if (f == null) return null;
  if (f === 'methadone') {
    const po = methadonePoEquivalent(dailyDose || 0, route);
    const perPoMg = methadoneFactor(po);
    const v = perPoMg * (route === 'IV' ? 2 : 1);
    return { lo: v, hi: v };
  }
  if (typeof f === 'number') return { lo: f, hi: f };
  return { lo: f.lo, hi: f.hi };
}
// Point factor used for MME totals (upper end of any range).
export function getFactor(drug, route, dailyDose) {
  const rg = getFactorRange(drug, route, dailyDose);
  return rg ? rg.hi : undefined;
}
export function hasFactor(drug, route) { return rawFactor(drug, route) != null; }
export function getRoutesForDrug(drug) {
  return Object.keys(getActiveTable().factors[drug] || {});
}
