// Equianalgesic-table registry. Each table is self-contained: factor map,
// methadone inbound/outbound tier functions, label + citation.
// At runtime the active table is looked up via settings.activeTable.
import { settings } from './settings.js';

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

export const TABLES = {
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

export const DEFAULT_TABLE = 'cdc';

export function getActiveTable() {
  return TABLES[settings.activeTable] || TABLES[DEFAULT_TABLE];
}
export function getFactor(drug, route) {
  const f = getActiveTable().factors[drug];
  return f ? f[route] : undefined;
}
export function getRoutesForDrug(drug) {
  return Object.keys(getActiveTable().factors[drug] || {});
}
export function methadoneInFactor(dailyMg)   { return getActiveTable().methadoneIn(dailyMg); }
export function methadoneOutFactor(mmeTotal) { return getActiveTable().methadoneOut(mmeTotal); }
