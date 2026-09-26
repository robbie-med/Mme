// Drug catalog (labels only) + brand-name aliases + display labels for routes.
// Conversion factors live in tables.js; this module is dependency-free.

export const DRUGS = {
  morphine:      { label: 'Morphine' },
  hydromorphone: { label: 'Hydromorphone' },
  oxycodone:     { label: 'Oxycodone' },
  oxymorphone:   { label: 'Oxymorphone' },
  hydrocodone:   { label: 'Hydrocodone' },
  codeine:       { label: 'Codeine' },
  tramadol:      { label: 'Tramadol' },
  tapentadol:    { label: 'Tapentadol' },
  meperidine:    { label: 'Meperidine' },
  fentanyl:      { label: 'Fentanyl' },
  methadone:     { label: 'Methadone' },
  levorphanol:   { label: 'Levorphanol' },
  buprenorphine: { label: 'Buprenorphine' },
  nalbuphine:    { label: 'Nalbuphine' },
  butorphanol:   { label: 'Butorphanol' },
};

export const DRUG_ALIASES = {
  'ms contin': 'morphine', 'msir': 'morphine', 'roxanol': 'morphine', 'duramorph': 'morphine',
  'dilaudid': 'hydromorphone', 'exalgo': 'hydromorphone',
  'oxycontin': 'oxycodone', 'roxicodone': 'oxycodone', 'roxicet': 'oxycodone',
  'percocet': 'oxycodone', 'oxyir': 'oxycodone',
  'opana': 'oxymorphone',
  'norco': 'hydrocodone', 'vicodin': 'hydrocodone', 'lortab': 'hydrocodone',
  'lorcet': 'hydrocodone', 'hysingla': 'hydrocodone', 'zohydro': 'hydrocodone',
  'tylenol with codeine': 'codeine',
  'ultram': 'tramadol',
  'nucynta': 'tapentadol',
  'demerol': 'meperidine',
  'duragesic': 'fentanyl', 'sublimaze': 'fentanyl', 'actiq': 'fentanyl',
  'fentora': 'fentanyl', 'subsys': 'fentanyl',
  'methadose': 'methadone', 'dolophine': 'methadone',
  'levo-dromoran': 'levorphanol',
  'subutex': 'buprenorphine', 'suboxone': 'buprenorphine', 'butrans': 'buprenorphine',
  'nubain': 'nalbuphine',
  'stadol': 'butorphanol',
};

export const ROUTE_LABELS = {
  PO: 'PO (oral)', IV: 'IV', IM: 'IM', SC: 'SC / SubQ', TD: 'Transdermal',
  SL: 'Buccal / SL / lozenge', NS: 'Nasal spray',
};

// Canonical dosing unit for each drug. Fentanyl is dosed in mcg (mcg/hr for
// patches); everything else in mg.
export function drugUnit(drugKey) { return drugKey === 'fentanyl' ? 'mcg' : 'mg'; }

// Convert a charted dose to the drug's canonical unit (mg, or mcg for
// fentanyl). Returns null for units that cannot be converted (e.g. mL).
export function toCanonicalDose(dose, unit, drugKey) {
  const u = String(unit || '').toLowerCase();
  const target = drugUnit(drugKey);
  const inMg = u === 'g' ? dose * 1000 : u === 'mg' ? dose : u === 'mcg' ? dose / 1000 : null;
  if (inMg == null) return null;
  return target === 'mcg' ? inMg * 1000 : inMg;
}
