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
  PO: 'PO (oral)', IV: 'IV', IM: 'IM', SC: 'SC / SubQ', TD: 'Transdermal', SL: 'Sublingual',
};

// Fentanyl is dosed in mcg; everything else in mg.
export function drugUnit(drugKey) { return drugKey === 'fentanyl' ? 'mcg' : 'mg'; }
