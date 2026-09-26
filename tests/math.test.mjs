// Known-answer tests for the MME math, conversion rules, parser and taper.
// Run with:  node --test tests/
// Expected values come from the sources cited in README "Sources".
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const { settings, patientContext } = await import('../js/settings.js');
const { computeEntryMME, previewMME, latestTimedTs } = await import('../js/mme.js');
const { getFactor, getFactorRange } = await import('../js/tables.js');
const { parseMAR, parseTimestamp } = await import('../js/mar-parser.js');
const {
  computeConversion, methadoneFromMED, patchFromMED, patchComposition,
} = await import('../js/conversion.js');
const { buildTaperSchedule } = await import('../js/taper.js');

const H = 3600e3;
const T0 = Date.UTC(2026, 4, 20, 8);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function withTable(key, fn) {
  const prev = settings.activeTable;
  settings.activeTable = key;
  try { fn(); } finally { settings.activeTable = prev; }
}
function standing(drug, route, daily, extra = {}) {
  return { id: 1, source: 'manual', drug, route, admins: [{ dose: daily, unit: drug === 'fentanyl' ? 'mcg' : 'mg', ts: Date.now() }], ...extra };
}
function parsed(drug, route, doses) {
  return { id: 2, source: 'parsed', drug, route, admins: doses.map(([h, dose, unit]) => ({ dose, unit: unit || 'mg', ts: T0 + h * H })) };
}
const row = (e, w = '24', anchor = Date.now()) => computeEntryMME(e, w, anchor);

// ---------- factor tables ----------

test('CDC 2022 table values (MMWR 2022;71(RR-3) Table)', () => {
  withTable('cdc', () => {
    assert.equal(getFactor('codeine', 'PO'), 0.15);
    assert.equal(getFactor('fentanyl', 'TD'), 2.4);
    assert.equal(getFactor('hydrocodone', 'PO'), 1);
    assert.equal(getFactor('hydromorphone', 'PO'), 5);
    assert.equal(getFactor('methadone', 'PO', 30), 4.7);
    assert.equal(getFactor('morphine', 'PO'), 1);
    assert.equal(getFactor('oxycodone', 'PO'), 1.5);
    assert.equal(getFactor('oxymorphone', 'PO'), 3);
    assert.equal(getFactor('tapentadol', 'PO'), 0.4);
    assert.equal(getFactor('tramadol', 'PO'), 0.2);
    assert.equal(getFactor('buprenorphine', 'SL'), undefined);
  });
});

test('CMS 2017 table: hydromorphone 4, tramadol 0.1, graduated methadone', () => {
  withTable('cms', () => {
    assert.equal(getFactor('hydromorphone', 'PO'), 4);
    assert.equal(getFactor('tramadol', 'PO'), 0.1);
    assert.equal(getFactor('methadone', 'PO', 20), 4);
    assert.equal(getFactor('methadone', 'PO', 20.5), 8);
    assert.equal(getFactor('methadone', 'PO', 40), 8);
    assert.equal(getFactor('methadone', 'PO', 60), 10);
    assert.equal(getFactor('methadone', 'PO', 61), 12);
    assert.equal(getFactor('meperidine', 'PO'), 0.1);
    assert.equal(getFactor('levorphanol', 'PO'), 11);
  });
});

test('parenteral ranges anchored to 10 mg IV morphine = 20–30 mg PO', () => {
  const m = getFactorRange('morphine', 'IV');
  assert.deepEqual(m, { lo: 2, hi: 3 });
  const h = getFactorRange('hydromorphone', 'IV');
  near(h.lo, 40 / 3); near(h.hi, 20);
  const f = getFactorRange('fentanyl', 'IV');
  assert.deepEqual(f, { lo: 0.1, hi: 0.3 });
  assert.equal(getFactorRange('codeine', 'IV'), null); // UofT: SC/IM, not IV
});

test('methadone IV is converted 1:2 to oral before the table factor', () => {
  withTable('cms', () => {
    // 15 mg/day IV = 30 mg/day PO-equivalent → CMS tier 8 → 240 MME
    const r = row(standing('methadone', 'IV', 15));
    near(r.mme, 240);
  });
  withTable('cdc', () => {
    near(row(standing('methadone', 'IV', 10)).mme, 94);
  });
});

// ---------- windows and normalization ----------

test('48 h window reports per day, not the 48 h total', () => {
  const e = parsed('oxycodone', 'PO', Array.from({ length: 12 }, (_, i) => [i * 4, 5]));
  const anchor = T0 + 44 * H;
  const r24 = row(e, '24', anchor);
  const r48 = row(e, '48', anchor);
  near(r24.normalizedDaily, 30); // 6 doses in (anchor−24h, anchor]
  near(r48.normalizedDaily, 30); // 12 doses × 5 mg / 48 h × 24
  near(r48.mme, 45);
});

test('window start is exclusive: once-daily dose is counted once', () => {
  const e = parsed('morphine', 'PO', [[0, 30], [24, 30]]);
  near(row(e, '24', T0 + 24 * H).normalizedDaily, 30);
});

test('"all" window adds one dosing interval to the observed span', () => {
  const e = parsed('oxycodone', 'PO', Array.from({ length: 12 }, (_, i) => [i * 4, 5]));
  const r = row(e, 'all', T0 + 44 * H);
  near(r.spanHours, 48);
  near(r.normalizedDaily, 30);
});

test('fentanyl patch counts for 72 h of wear, then drops out with a note', () => {
  const e = parsed('fentanyl', 'TD', [[0, 25, 'mcg']]);
  near(row(e, '24', T0 + 36 * H).mme, 60);
  const late = row(e, '24', T0 + 80 * H);
  assert.equal(late.mme, 0);
  assert.equal(late.notes.length, 1);
});

test('typed-in regimens are never windowed out', () => {
  const old = standing('morphine', 'PO', 60);
  old.admins[0].ts = Date.now() - 30 * H;
  near(row(old, '24', Date.now()).mme, 60);
  // and they do not become the anchor for charted doses
  assert.equal(latestTimedTs([old, parsed('oxycodone', 'PO', [[0, 5]])]), T0);
});

test('doses charted in other units are converted per dose', () => {
  const e = parsed('fentanyl', 'IV', [[0, 0.05, 'mg'], [1, 50, 'mcg']]);
  near(row(e, '24', T0 + 2 * H).normalizedDaily, 100);
});

// ---------- parser ----------

test('parser reads 12-hour times and flags a missing route', () => {
  assert.equal(new Date(parseTimestamp('5/25/26', '2:30 pm')).getHours(), 14);
  assert.equal(new Date(parseTimestamp('5/25/26', '12:05 AM')).getHours(), 0);
  assert.equal(new Date(parseTimestamp('5/25/26', '12:05 pm')).getHours(), 12);
  const { orders, warnings } = parseMAR('hydromorphone\n0.5 mg, q3 hr PRN\n5/25/26\n2:30 pm\n0.5 mg');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].admins.length, 1);
  assert.equal(orders[0].route, 'PO');
  assert.ok(warnings.some(w => /assumed PO/.test(w)));
});

// ---------- conversion ----------

const rowsFor = (...entries) => entries.map(e => computeEntryMME(e, '24', Date.now()));

test('methadone target follows label Table 1, is monotonic and capped at 30 mg/day', () => {
  near(methadoneFromMED(50).daily, 10);   // 20%
  near(methadoneFromMED(100).daily, 20);  // 10% = 10 → held at 20 (monotonic)
  near(methadoneFromMED(250).daily, 25);  // 10%
  near(methadoneFromMED(400).daily, 30);  // capped
  let prev = 0;
  for (let m = 1; m <= 2000; m++) {
    const d = methadoneFromMED(m).daily;
    assert.ok(d >= prev - 1e-9, `drop at ${m}`);
    assert.ok(d <= 30);
    prev = d;
  }
});

test('methadone orders are rounded down and never above the calculation', () => {
  const c = computeConversion(rowsFor(standing('morphine', 'PO', 400)), 'methadone|PO', 50);
  assert.equal(c.reductionApplied, 0);
  const p = c.orders.primary;
  assert.ok(p.dose * p.perDay <= c.calculatedDaily + 1e-9);
  assert.equal(p.dose, 10); // 30 mg/day ÷ 3
});

test('fentanyl patch target follows label Table 2 and requires opioid tolerance', () => {
  assert.equal(patchFromMED(59).reason, 'not-tolerant');
  assert.equal(patchFromMED(60).rate, 25);
  assert.equal(patchFromMED(134).rate, 25);
  assert.equal(patchFromMED(135).rate, 50);
  assert.equal(patchFromMED(314).rate, 75);
  assert.equal(patchFromMED(315).rate, 100);
  assert.equal(patchFromMED(1124).rate, 300);
  assert.equal(patchFromMED(1125).reason, 'beyond-table');
  assert.equal(patchComposition(125), '100 + 25');
  const c = computeConversion(rowsFor(standing('morphine', 'PO', 40)), 'fentanyl|TD', 50);
  assert.ok(c.blocked);
});

test('scheduled orders never exceed the calculated daily dose (all targets, many totals)', () => {
  const targets = ['morphine|PO', 'hydromorphone|PO', 'oxycodone|PO', 'oxymorphone|PO', 'hydrocodone|PO',
    'codeine|PO', 'tramadol|PO', 'tapentadol|PO', 'morphine|IV', 'hydromorphone|IV', 'fentanyl|IV'];
  for (const tbl of ['cdc', 'cms']) withTable(tbl, () => {
    for (const t of targets) for (const mme of [5, 12, 30, 45, 60, 90, 135, 240, 600]) {
      const c = computeConversion(rowsFor(standing('morphine', 'PO', mme)), t, 50);
      if (!c.orders || !c.orders.primary) continue;
      const p = c.orders.primary;
      const ordered = p.dose * p.perDay;
      assert.ok(ordered <= c.calculatedDaily + 1e-9, `${tbl} ${t} @${mme}: ${ordered} > ${c.calculatedDaily}`);
      assert.ok(c.projectedMME <= c.basisMME * 0.5 + 1e-6, `${tbl} ${t} @${mme}: projected ${c.projectedMME}`);
    }
  });
});

test('regression: 30 MME → morphine IV no longer suggests 5 mg q4h (90 MME)', () => {
  const c = computeConversion(rowsFor(standing('morphine', 'PO', 30)), 'morphine|IV', 25);
  assert.ok(c.projectedMME <= 30 * 0.75);
});

test('tramadol target is capped at its labeled maximum with a warning', () => {
  withTable('cms', () => {
    const c = computeConversion(rowsFor(standing('morphine', 'PO', 100)), 'tramadol|PO', 50);
    near(c.calculatedDaily, 500);
    assert.ok(c.orders.warnings.some(w => /400/.test(w)));
    const p = c.orders.primary;
    assert.ok(p.dose * p.perDay <= 400);
  });
  patientContext.age = '75plus';
  try {
    withTable('cms', () => {
      const c = computeConversion(rowsFor(standing('morphine', 'PO', 100)), 'tramadol|PO', 50);
      const p = c.orders.primary;
      assert.ok(p.dose * p.perDay <= 300);
    });
  } finally { patientContext.age = 'unspecified'; }
});

test('ER products use their labeled frequency', () => {
  const hm = computeConversion(rowsFor(standing('morphine', 'PO', 200)), 'hydromorphone|PO', 50);
  assert.equal(hm.orders.primary.perDay, 1);
  assert.equal(hm.orders.primary.dose % 4, 0);
  const oxy = computeConversion(rowsFor(standing('morphine', 'PO', 200)), 'oxycodone|PO', 50);
  assert.equal(oxy.orders.primary.perDay, 2);
});

test('conversion basis uses the lower factor for parenteral sources', () => {
  const c = computeConversion(rowsFor(standing('hydromorphone', 'IV', 3)), 'oxycodone|PO', 50);
  near(c.riskMME, 60);
  near(c.basisMME, 40);
});

test('converting away from methadone is blocked', () => {
  const c = computeConversion(rowsFor(standing('methadone', 'PO', 30)), 'morphine|PO', 50);
  assert.ok(c.blocked);
  assert.equal(c.orders, null);
});

// ---------- taper ----------

test('CDC long-term taper: monotonic, ≤10% of original per step, reaches stop', () => {
  const primary = { drug: 'morphine', route: 'PO', dose: 30, perDay: 2, er: true };
  const s = buildTaperSchedule({ primary, presetKey: 'cdc-long', endpointPct: 0 });
  assert.equal(s.truncated, false);
  assert.equal(s[s.length - 1].dose, 0);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].dose < s[i - 1].dose);
    if (s[i].dose > 0) assert.ok(s[i - 1].dose - s[i].dose <= 30 * 0.10 + 2.5 + 1e-9);
  }
});

test('patch taper uses marketed strengths only', () => {
  const primary = { drug: 'fentanyl', route: 'TD', dose: 75, perDay: 1 };
  const s = buildTaperSchedule({ primary, presetKey: 'label-max', endpointPct: 0 });
  s.forEach(x => assert.equal((x.dose / 12.5) % 1, 0, `${x.dose}`));
});

test('previewMME matches computeEntryMME for standing entries', () => {
  near(previewMME('oxycodone', 'PO', 10, 2), row(standing('oxycodone', 'PO', 20)).mme);
  near(previewMME('fentanyl', 'TD', 25, 1), 60);
});

// ---------- references ----------

const { REFS } = await import('../js/refs.js');
const { buildSafetyAlerts } = await import('../js/safety.js');
const { TABLES } = await import('../js/tables.js');

test('every reference has an https URL and every cited key exists', () => {
  for (const [k, r] of Object.entries(REFS)) {
    assert.match(r.url, /^https:\/\//, k);
    assert.ok(r.title && r.short, k);
  }
  const used = new Set();
  Object.values(TABLES).forEach(t => (t.refs || []).forEach(k => used.add(k)));
  const targets = ['morphine|PO', 'hydromorphone|PO', 'oxycodone|PO', 'tramadol|PO', 'tapentadol|PO',
    'codeine|PO', 'hydrocodone|PO', 'morphine|IV', 'hydromorphone|IV', 'fentanyl|IV', 'fentanyl|TD', 'methadone|PO'];
  for (const t of targets) {
    const c = computeConversion(rowsFor(standing('morphine', 'PO', 200)), t, 50);
    assert.ok(c.refs.length > 0, t);
    c.refs.forEach(k => used.add(k));
  }
  buildSafetyAlerts(120, { age: '75plus', renal: 'dialysis', hepatic: 'severe', benzo: true, sleepApnea: true, odHistory: true })
    .forEach(a => { assert.ok(a.refs && a.refs.length, a.title); a.refs.forEach(k => used.add(k)); });
  used.forEach(k => assert.ok(REFS[k], `unknown ref key ${k}`));
});
