// Pharmacokinetics: per-drug, per-route onset / peak / half-life and a curve
// model that turns one dose admin into an effect-vs-time function.
//
// The curve is the standard one-compartment Bateman shape
//   C(t) = e^(-kel·t) − e^(-ka·t)
// scaled so peak = 1 at t = peakMin, then multiplied by the dose's MME so the
// y-axis carries clinical meaning. Transdermal patches use a piecewise model:
// linear ramp to plateau, plateau at steady-state delivery rate, exponential
// decay after removal.
//
// Values are typical adult PK from Goodman & Gilman, UpToDate, and US package
// inserts. They are for visualization, not for dose individualization.

export const PK = {
  morphine: {
    PO: { onsetMin: 30, peakMin: 60, halfLifeMin: 180 },
    IV: { onsetMin: 2,  peakMin: 18, halfLifeMin: 150 },
    IM: { onsetMin: 15, peakMin: 45, halfLifeMin: 180 },
    SC: { onsetMin: 15, peakMin: 60, halfLifeMin: 180 },
  },
  hydromorphone: {
    PO: { onsetMin: 20, peakMin: 45, halfLifeMin: 150 },
    IV: { onsetMin: 3,  peakMin: 18, halfLifeMin: 150 },
    IM: { onsetMin: 10, peakMin: 30, halfLifeMin: 150 },
    SC: { onsetMin: 10, peakMin: 30, halfLifeMin: 150 },
  },
  oxycodone: {
    PO: { onsetMin: 15, peakMin: 60, halfLifeMin: 210 },
  },
  oxymorphone: {
    PO: { onsetMin: 30, peakMin: 60, halfLifeMin: 480 },
    IV: { onsetMin: 5,  peakMin: 20, halfLifeMin: 480 },
    IM: { onsetMin: 10, peakMin: 30, halfLifeMin: 480 },
    SC: { onsetMin: 10, peakMin: 30, halfLifeMin: 480 },
  },
  hydrocodone: {
    PO: { onsetMin: 30, peakMin: 75, halfLifeMin: 240 },
  },
  codeine: {
    PO: { onsetMin: 35, peakMin: 75, halfLifeMin: 180 },
    IV: { onsetMin: 10, peakMin: 30, halfLifeMin: 180 },
    IM: { onsetMin: 10, peakMin: 30, halfLifeMin: 180 },
    SC: { onsetMin: 10, peakMin: 30, halfLifeMin: 180 },
  },
  tramadol: {
    PO: { onsetMin: 60, peakMin: 120, halfLifeMin: 360 },
  },
  tapentadol: {
    PO: { onsetMin: 30, peakMin: 75, halfLifeMin: 240 },
  },
  meperidine: {
    PO: { onsetMin: 15, peakMin: 60, halfLifeMin: 210 },
    IV: { onsetMin: 3,  peakMin: 7,  halfLifeMin: 210 },
    IM: { onsetMin: 10, peakMin: 30, halfLifeMin: 210 },
    SC: { onsetMin: 10, peakMin: 30, halfLifeMin: 210 },
  },
  fentanyl: {
    IV: { onsetMin: 1, peakMin: 4,  halfLifeMin: 180 },
    IM: { onsetMin: 5, peakMin: 10, halfLifeMin: 180 },
    SL: { onsetMin: 5, peakMin: 20, halfLifeMin: 180 },
    TD: { onsetMin: 720, plateauMin: 72 * 60, decayHalfLifeMin: 1020 },
  },
  methadone: {
    PO: { onsetMin: 45, peakMin: 180, halfLifeMin: 1440 },
    IV: { onsetMin: 10, peakMin: 30,  halfLifeMin: 1440 },
  },
  levorphanol: {
    PO: { onsetMin: 30, peakMin: 75, halfLifeMin: 720 },
  },
  buprenorphine: {
    SL: { onsetMin: 30, peakMin: 90,  halfLifeMin: 1800 },
    IV: { onsetMin: 5,  peakMin: 30,  halfLifeMin: 1800 },
    IM: { onsetMin: 10, peakMin: 60,  halfLifeMin: 1800 },
    TD: { onsetMin: 720, plateauMin: 168 * 60, decayHalfLifeMin: 1800 },
  },
  nalbuphine: {
    IV: { onsetMin: 3,  peakMin: 30, halfLifeMin: 240 },
    IM: { onsetMin: 15, peakMin: 60, halfLifeMin: 240 },
    SC: { onsetMin: 15, peakMin: 60, halfLifeMin: 240 },
  },
  butorphanol: {
    IV: { onsetMin: 2,  peakMin: 30, halfLifeMin: 210 },
    IM: { onsetMin: 10, peakMin: 45, halfLifeMin: 210 },
  },
};

// Dominant clearance pathway, used to translate organ-function context into a
// half-life multiplier. "renal" = parent or active metabolite cleared by the
// kidney (morphine via M6G, hydromorphone via H3G, codeine via morphine,
// meperidine via normeperidine). "hepatic" = CYP/UGT metabolism. "mixed" =
// meaningful contribution from both (oxymorphone: glucuronidation + renal).
export const CLEARANCE = {
  morphine: 'renal',
  hydromorphone: 'renal',
  codeine: 'renal',
  meperidine: 'renal',
  oxymorphone: 'mixed',
  oxycodone: 'hepatic',
  hydrocodone: 'hepatic',
  fentanyl: 'hepatic',
  methadone: 'hepatic',
  tramadol: 'hepatic',
  tapentadol: 'hepatic',
  buprenorphine: 'hepatic',
  levorphanol: 'hepatic',
  nalbuphine: 'hepatic',
  butorphanol: 'hepatic',
};

// Multiplicative half-life adjustments. Numbers are clinically-pragmatic
// approximations from package-insert PK tables and palliative-care references;
// they are for visualisation, not dose individualization.
const RENAL_MULT = { mild: 1.1, moderate: 1.4, severe: 1.8, dialysis: 2.2 };
const HEPATIC_MULT = { mild: 1.15, moderate: 1.5, severe: 2.0 };
const AGE_MULT = { '65-74': 1.15, '75plus': 1.35 };

export function organMultiplier(drug, ctx) {
  if (!ctx) return 1;
  const cls = CLEARANCE[drug] || 'hepatic';
  let m = 1;
  const r = RENAL_MULT[ctx.renal];
  const h = HEPATIC_MULT[ctx.hepatic];
  if (cls === 'renal' && r) m *= r;
  else if (cls === 'hepatic' && h) m *= h;
  else if (cls === 'mixed') {
    if (r) m *= 1 + (r - 1) * 0.5;
    if (h) m *= 1 + (h - 1) * 0.5;
  }
  const a = AGE_MULT[ctx.age];
  if (a) m *= a;
  return m;
}

export function getPK(drug, route) {
  const d = PK[drug];
  if (!d) return null;
  if (d[route]) return d[route];
  return d.PO || d.IV || d.SL || d.TD || Object.values(d)[0] || null;
}

// Solve ka for the absorption-elimination model so that tmax = peakMin.
// tmax = ln(ka/kel) / (ka − kel); bisect for the unique ka > kel root.
function solveKa(peakMin, kel) {
  const f = ka => Math.log(ka / kel) - peakMin * (ka - kel);
  let lo = kel * 1.0001;
  let hi = kel * 50;
  let flo = f(lo), fhi = f(hi);
  let iter = 0;
  while (flo * fhi > 0 && hi < kel * 1e8 && iter < 40) {
    hi *= 2; fhi = f(hi); iter++;
  }
  if (flo * fhi > 0) return kel * 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// Cache (peakMin, halfLifeMin) → {ka, kel, peakVal} so the bisect runs once.
const shapeCache = new Map();
function getShape(peakMin, halfLifeMin) {
  const key = peakMin + '|' + halfLifeMin;
  let s = shapeCache.get(key);
  if (!s) {
    const kel = Math.LN2 / halfLifeMin;
    const ka = solveKa(peakMin, kel);
    const peakVal = Math.exp(-kel * peakMin) - Math.exp(-ka * peakMin);
    s = { ka, kel, peakVal: peakVal > 0 ? peakVal : 1 };
    shapeCache.set(key, s);
  }
  return s;
}

// Effect intensity (peak-normalised to 1) at tMin minutes after admin.
function batemanShape(tMin, peakMin, halfLifeMin) {
  if (tMin <= 0) return 0;
  const { ka, kel, peakVal } = getShape(peakMin, halfLifeMin);
  const v = Math.exp(-kel * tMin) - Math.exp(-ka * tMin);
  return v > 0 ? v / peakVal : 0;
}

// Intensity at tMin for one admin: peak ≈ scale (MME for the dose), zero before
// admin, follows the PK curve after. Patches plateau across the wear interval
// and decay afterwards. Returns 0 for drugs/routes with no PK entry.
export function doseIntensity(drug, route, scale, tMin, ctx) {
  const pk = getPK(drug, route);
  if (!pk || !scale) return 0;
  const mult = organMultiplier(drug, ctx);
  if (pk.plateauMin != null) {
    if (tMin <= 0) return 0;
    const onset = pk.onsetMin;
    const end = onset + pk.plateauMin;
    if (tMin < onset) return (tMin / onset) * scale;
    if (tMin <= end) return scale;
    return scale * Math.exp(-Math.LN2 * (tMin - end) / (pk.decayHalfLifeMin * mult));
  }
  return batemanShape(tMin, pk.peakMin, pk.halfLifeMin * mult) * scale;
}

// How long after admin the curve is still meaningful (≥1% of peak).
// Used to skip work for dose curves that have fully decayed by chart start.
export function doseDurationMin(drug, route, ctx) {
  const pk = getPK(drug, route);
  if (!pk) return 0;
  const mult = organMultiplier(drug, ctx);
  if (pk.plateauMin != null) return pk.onsetMin + pk.plateauMin + 7 * pk.decayHalfLifeMin * mult;
  return Math.max(pk.peakMin, pk.halfLifeMin * mult) * 7;
}
