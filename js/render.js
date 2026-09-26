// All DOM rendering: simple cards, complex table, totals, safety alerts,
// conversion result, derivation panels, warnings, reference table.
// Subscribers in main.js call render() whenever ledger/view/settings change.
import { DRUGS, ROUTE_LABELS, drugUnit } from './drugs.js';
import { getActiveTable, getRoutesForDrug, getFactorRange, SOURCES } from './tables.js';
import { computeEntryMME, formatNum, formatDate, latestTimedTs } from './mme.js';
import { ledger, removeEntry } from './ledger.js';
import { view, expandedRows, viewState, setTotalExpanded } from './views.js';
import { getRiskTier, buildSafetyAlerts } from './safety.js';
import {
  computeConversion, renderConversionOrders, buildBeforeAfter, applyProposedRegimen,
} from './conversion.js';
import { buildTaperSection, wireTaperControls } from './taper.js';
import { escapeHtml } from './util.js';

function wireRowExpansion(wrap) {
  wrap.querySelectorAll('[data-expand]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = Number(btn.dataset.expand);
      if (expandedRows.has(id)) expandedRows.delete(id); else expandedRows.add(id);
      render();
    });
  });
}

function citationFor(entry) {
  const t = getActiveTable();
  const parts = [`${t.label}: ${t.cite}`];
  const rg = getFactorRange(entry.drug, entry.route, 0);
  if (entry.drug === 'methadone' && entry.route === 'IV') parts.push(SOURCES.methadoneLabel);
  if (entry.drug === 'nalbuphine') parts.push(SOURCES.nalbuphineLabel);
  if (rg && rg.lo !== rg.hi) parts.push(`Parenteral range: ${SOURCES.uoft}`);
  if (entry.drug === 'fentanyl' && entry.route === 'TD') parts.push('Patch counted for 72 h of wear from its most recent application (patch label).');
  return parts.join(' ');
}

function windowStep(r, u) {
  const e = r.entry;
  if (r.basis === 'standing') {
    return `Entered as a daily regimen (${escapeHtml(e.label || '')}); not filtered by the time window`;
  }
  if (r.basis === 'patch') {
    if (!r.kept.length) return 'No patch within its 72 h wear period at the window anchor';
    const a = r.kept[0];
    return `Most recent application ${formatDate(a.ts)} (within 72 h wear) · <strong>${formatNum(r.normalizedDaily)} mcg/hr</strong>`;
  }
  if (!r.kept.length) return '0 doses in window; contributes 0 MME';
  if (r.basis === 'all') {
    return `${formatNum(r.totalDose)} ${u} over ${formatNum(r.spanHours)} h (first → last dose + one median dosing interval, minimum 24 h) × 24 / ${formatNum(r.spanHours)} = <strong>${formatNum(r.normalizedDaily)} ${u}/day</strong>`;
  }
  return `${formatNum(r.totalDose)} ${u} in ${formatNum(r.spanHours)} h × 24 / ${formatNum(r.spanHours)} = <strong>${formatNum(r.normalizedDaily)} ${u}/day</strong>`;
}

function buildDerivation(r) {
  const e = r.entry;
  const drugLabel = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
  const u = drugUnit(e.drug);
  const parts = [];
  parts.push(`<div class="d-step"><span class="d-label">Medication</span><span class="d-value">${escapeHtml(drugLabel)} ${escapeHtml(ROUTE_LABELS[e.route] || e.route)} <span class="source-tag ${e.source}">${e.source}</span></span></div>`);
  if (r.basis !== 'standing' && r.kept.length > 0) {
    const adminLines = r.kept.slice(0, 30).map(a =>
      `<div>${formatDate(a.ts)} &middot; ${formatNum(a.dose)} ${escapeHtml(a.unit)}</div>`).join('');
    parts.push(`<div class="d-step"><span class="d-label">Doses counted</span><span class="d-value">${r.kept.length} dose${r.kept.length === 1 ? '' : 's'}<div class="d-admins">${adminLines}${r.kept.length > 30 ? '<div>…</div>' : ''}</div></span></div>`);
  }
  parts.push(`<div class="d-step"><span class="d-label">Daily dose</span><span class="d-value">${windowStep(r, u)}</span></div>`);
  parts.push(`<div class="d-step"><span class="d-label">Calculation</span><span class="d-value">${escapeHtml(r.factorDescription || '—')}</span></div>`);
  parts.push(`<div class="d-step d-result"><span class="d-label">MME / day</span><span class="d-value"><strong>${r.mme == null ? '—' : formatNum(r.mme)}</strong>${r.mmeLow != null && r.mmeLow !== r.mme ? ` <span class="muted">(conversion basis ${formatNum(r.mmeLow)})</span>` : ''}</span></div>`);
  r.notes.forEach(n => parts.push(`<div class="d-step"><span class="d-label">Note</span><span class="d-value">${escapeHtml(n)}</span></div>`));
  parts.push(`<div class="d-cite">${escapeHtml(citationFor(e))}</div>`);
  return parts.join('');
}

function buildTotalDerivation(rows, totalMME) {
  if (!rows.length) return '<p class="hint">No medications to summarize.</p>';
  const lines = rows.map(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    return `<div class="t-line">
      <span class="t-name">${escapeHtml(drug)} ${escapeHtml(e.route)}</span>
      <span class="t-detail">${escapeHtml(r.factorDescription || '—')}</span>
      <span class="t-mme">${r.mme == null ? '—' : formatNum(r.mme)} MME</span>
    </div>`;
  }).join('');
  return `<div class="t-derivation">${lines}
    <div class="t-line t-sum"><span class="t-name">Total</span><span class="t-detail"></span><span class="t-mme">${formatNum(totalMME)} MME / day</span></div></div>`;
}

export function getWindowSettings() {
  let windowHours = '24', anchorMode = 'latest';
  if (view.current === 'complex') {
    windowHours = document.getElementById('time-window').value;
    anchorMode = document.getElementById('window-anchor').value;
  }
  let anchorTs;
  if (anchorMode === 'now') anchorTs = Date.now();
  else anchorTs = latestTimedTs(ledger) ?? Date.now();
  return { windowHours, anchorMode, anchorTs };
}

export function getRowsForActiveView() {
  const { windowHours, anchorTs } = getWindowSettings();
  return ledger.map(e => computeEntryMME(e, windowHours, anchorTs));
}

export function render() {
  const rows = getRowsForActiveView();
  const totalMME = rows.reduce((s, r) => s + (r.mme || 0), 0);
  if (view.current === 'simple') {
    renderSimpleList(rows);
  } else if (view.current === 'complex') {
    renderComplexTable(rows);
    renderWarnings(rows);
  }
  renderTotals(rows, totalMME);
  renderSafety(totalMME);
  renderConversion(rows, totalMME);
  renderReferenceTable();
}

function renderSafety(totalMME) {
  const tier = getRiskTier(totalMME);
  const badge = document.getElementById('risk-badge');
  if (badge) {
    badge.className = 'risk-badge risk-' + tier.level;
    badge.textContent = totalMME > 0 ? `${tier.label} · ${tier.explain}` : tier.label;
  }
  const totalsCard = document.querySelector('.card.totals');
  if (totalsCard) {
    totalsCard.classList.remove('risk-low', 'risk-caution', 'risk-high');
    totalsCard.classList.add('risk-' + tier.level);
  }
  const el = document.getElementById('safety-alerts');
  if (!el) return;
  const alerts = totalMME > 0 || ledger.length > 0 ? buildSafetyAlerts(totalMME) : [];
  if (!alerts.length) { el.innerHTML = ''; return; }
  el.innerHTML = alerts.map(a => `
    <div class="safety-alert ${a.severity === 'severe' ? 'severe' : ''}">
      <h4>${escapeHtml(a.title)}</h4>
      <p>${escapeHtml(a.body)}</p>
      <div class="alert-cite">${escapeHtml(a.cite)}</div>
    </div>`).join('');
}

function renderSimpleList(rows) {
  const wrap = document.getElementById('simple-meds-list');
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-state">No medications yet. Add one above.</p>';
    return;
  }
  wrap.innerHTML = rows.map(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    const routeClass = ({PO:'po', IV:'iv', IM:'iv', SC:'iv', TD:'td'})[e.route] || '';
    const routeLabel = ROUTE_LABELS[e.route] || e.route;
    const expanded = expandedRows.has(e.id);
    return `
      <div class="simple-med ${expanded ? 'expanded' : ''}" data-id="${e.id}">
        <div class="simple-med-row">
          <div class="simple-med-main">
            <div class="simple-med-name">${escapeHtml(drug)} <span class="tag ${routeClass}" style="font-size:11px">${escapeHtml(routeLabel)}</span></div>
            <div class="simple-med-sub">${escapeHtml(e.label || '')}</div>
          </div>
          <button class="simple-med-mme mme-clickable" data-expand="${e.id}" title="Show calculation">
            ${r.mme == null ? '—' : formatNum(r.mme)}<span class="simple-med-mme-unit">MME</span>
          </button>
          <button class="remove-btn" data-remove="${e.id}" title="Remove">×</button>
        </div>
        ${expanded ? `<div class="derivation-panel">${buildDerivation(r)}</div>` : ''}
      </div>`;
  }).join('');
  wireRowExpansion(wrap);
  wrap.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeEntry(Number(btn.dataset.remove)); }));
}

function renderComplexTable(rows) {
  const wrap = document.getElementById('meds-table-wrap');
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty-state">No medications yet. Add one above, or paste an MAR.</p>';
    return;
  }
  const trs = [];
  rows.forEach(r => {
    const e = r.entry;
    const drug = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
    const routeClass = ({PO:'po', IV:'iv', IM:'iv', SC:'iv', TD:'td'})[e.route] || '';
    const isTD = e.drug === 'fentanyl' && e.route === 'TD';
    const u = drugUnit(e.drug);
    const srcTag = `<span class="source-tag ${e.source}">${e.source}</span>`;
    let detail = e.label || '';
    if (e.source === 'parsed' && r.kept.length) {
      detail = r.kept.slice(0, 5).map(a => formatDate(a.ts) + ' · ' + formatNum(a.dose) + a.unit).join(' | ') +
        (r.kept.length > 5 ? ' …' : '');
    }
    const counted = r.basis === 'standing' ? 'daily' : String(r.kept.length);
    const windowTotal = r.basis === 'standing' || isTD ? '—' : `${formatNum(r.totalDose)} ${u}`;
    const perDay = isTD ? `${formatNum(r.normalizedDaily)} mcg/hr` : `${formatNum(r.normalizedDaily)} ${u}`;
    trs.push(`<tr data-id="${e.id}">
      <td><div><strong>${escapeHtml(drug)}</strong> ${srcTag}</div>
        <div class="admin-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div></td>
      <td><span class="tag ${routeClass}">${escapeHtml(e.route)}</span></td>
      <td class="num">${counted}</td>
      <td class="num">${windowTotal}</td>
      <td class="num">${perDay}</td>
      <td class="admin-detail" style="max-width:none">${escapeHtml(r.factorDescription)}</td>
      <td class="num mme"><button class="mme-clickable" data-expand="${e.id}" title="Show calculation">${r.mme == null ? '—' : formatNum(r.mme)}</button></td>
      <td><button class="remove-btn" data-remove="${e.id}" title="Remove">×</button></td>
    </tr>`);
    if (expandedRows.has(e.id)) {
      trs.push(`<tr class="meds-detail"><td colspan="8"><div class="derivation-panel">${buildDerivation(r)}</div></td></tr>`);
    }
  });
  wrap.innerHTML = `
    <table class="meds">
      <thead><tr>
        <th>Medication</th><th>Route</th>
        <th class="num">Doses counted</th><th class="num">Total in window</th>
        <th class="num">Per day</th><th>Calc</th>
        <th class="num">MME / day</th><th></th>
      </tr></thead>
      <tbody>${trs.join('')}</tbody>
    </table>`;
  wireRowExpansion(wrap);
  wrap.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeEntry(Number(btn.dataset.remove)); }));
}

function renderWarnings(rows) {
  const el = document.getElementById('warnings');
  if (!el) return;
  const items = [];
  // Numeric windows divide by the window length. If the charted doses do not
  // reach back that far, the per-day figure is understated; say so.
  const { windowHours, anchorTs } = getWindowSettings();
  if (windowHours !== 'all') {
    let earliest = null;
    ledger.forEach(e => {
      if (e.source !== 'parsed' && !e._timesSet) return;
      e.admins.forEach(a => { if (Number.isFinite(a.ts) && (earliest == null || a.ts < earliest)) earliest = a.ts; });
    });
    const covered = earliest == null ? null : (anchorTs - earliest) / 3600000;
    if (covered != null && covered + 4 < Number(windowHours)) {
      items.push(`Charted doses cover only about ${Math.round(covered)} h of the ${windowHours} h window, so per-day values for charted meds may be understated. Choose a shorter window or "All shown".`);
    }
  }
  rows.forEach(r => {
    const name = DRUGS[r.entry.drug] ? DRUGS[r.entry.drug].label : r.entry.drug;
    if (r.mme == null) {
      items.push(r.entry.drug === 'buprenorphine'
        ? 'Buprenorphine is not counted in MME: CDC 2022 excludes it (partial agonist with a ceiling effect).'
        : `No MME factor for ${name} (${r.entry.route}); excluded from total.`);
    }
    if (r.entry.drug === 'methadone' && r.normalizedDaily > 0) items.push('Methadone conversions are highly variable. Confirm dose with a pain or palliative specialist.');
    if (r.entry.parseWarnings) r.entry.parseWarnings.forEach(w => items.push(`${name}: ${w}`));
    r.notes.forEach(n => items.push(`${name}: ${n}`));
  });
  if (!items.length) { el.innerHTML = ''; return; }
  const uniq = Array.from(new Set(items));
  el.innerHTML = '<div class="warning"><strong>Notes</strong><ul>' + uniq.map(t => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div>';
}

function renderTotals(rows, totalMME) {
  document.getElementById('total-mme').textContent = formatNum(totalMME);
  let windowLabel = 'last 24 h (charted doses); typed-in regimens count as daily';
  if (view.current === 'complex') {
    const w = document.getElementById('time-window').value;
    windowLabel = w === 'all' ? 'all charted doses, normalized to 24 h' : `last ${w} h, normalized to 24 h`;
  }
  const drugCount = rows.filter(r => r.mme && r.mme > 0).length;
  const tableLabel = getActiveTable().label;
  document.getElementById('totals-detail').textContent =
    `Sum across ${drugCount} medication${drugCount === 1 ? '' : 's'} · window: ${windowLabel} · factors: ${tableLabel}`;

  const valWrap = document.getElementById('total-value-wrap');
  if (valWrap) {
    valWrap.classList.toggle('clickable', totalMME > 0);
    valWrap.onclick = totalMME > 0 ? () => { setTotalExpanded(!viewState.totalExpanded); render(); } : null;
  }
  let expEl = document.getElementById('total-derivation');
  if (!expEl) {
    expEl = document.createElement('div');
    expEl.id = 'total-derivation';
    expEl.className = 'total-derivation-panel';
    document.querySelector('.card.totals .big-number').appendChild(expEl);
  }
  if (viewState.totalExpanded && totalMME > 0) {
    expEl.hidden = false;
    expEl.innerHTML = buildTotalDerivation(rows, totalMME);
  } else {
    expEl.hidden = true;
    expEl.innerHTML = '';
  }
}

function renderSteps(steps) {
  return `<div class="conv-steps">${steps.map(s =>
    `<div class="conv-step"><span class="conv-step-k">${escapeHtml(s.k)}</span><span class="conv-step-v">${escapeHtml(s.v)}</span></div>`).join('')}</div>`;
}

function renderConversion(rows, totalMME) {
  const el = document.getElementById('conversion-result');
  const target = document.getElementById('target-drug').value;
  if (!totalMME || totalMME <= 0 || !target) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const reduction = Number(document.getElementById('reduction').value);
  const conv = computeConversion(rows, target, reduction);
  el.classList.add('show');
  if (!conv) {
    el.innerHTML = '<strong>No conversion factor</strong> available for this target in the active table.';
    return;
  }
  if (conv.error) { el.innerHTML = escapeHtml(conv.error); return; }

  const steps = conv.steps.slice();
  if (conv.orderedDaily != null && conv.calculatedDaily > 0) {
    const pct = Math.round((conv.orderedDaily / conv.calculatedDaily) * 100);
    const u = conv.drug === 'fentanyl' && conv.route === 'TD' ? 'mcg/hr' : conv.unitDaily;
    steps.push({ k: 'Ordered (rounded down)', v: `${formatNum(conv.orderedDaily)} ${u} = ${pct}% of calculated` });
  }
  const warn = conv.warnings.length
    ? `<div class="conv-warnings">${conv.warnings.map(w => `<div class="conv-warning">${escapeHtml(w)}</div>`).join('')}</div>` : '';
  const notes = conv.notes.length
    ? `<div class="conv-notes">${conv.notes.map(n => `<div class="conv-note">${escapeHtml(n)}</div>`).join('')}</div>` : '';
  const head = conv.calculatedDaily != null
    ? `<div>Calculated equivalent of <strong>${escapeHtml(conv.label)}</strong>:</div>
       <div class="target-dose">${formatNum(conv.calculatedDaily)} ${escapeHtml(conv.unitDaily)}</div>`
    : `<div>Conversion to <strong>${escapeHtml(conv.label)}</strong></div>`;

  let body;
  if (conv.blocked) {
    body = `<div class="conv-blocked">${escapeHtml(conv.blocked)}</div>${notes}`;
  } else {
    body = `${renderConversionOrders(conv.orders)}${notes}
      ${buildBeforeAfter(rows, totalMME, conv)}
      ${conv.orders && conv.orders.primary ? buildTaperSection(conv.orders.primary, conv.projectedMME) : ''}`;
  }
  el.innerHTML = `${head}${warn}${renderSteps(steps)}${body}`;

  const applyBtn = el.querySelector('#apply-regimen-btn');
  if (applyBtn) applyBtn.addEventListener('click', () => {
    applyProposedRegimen(applyBtn.dataset.drug, applyBtn.dataset.route,
                         applyBtn.dataset.dose, applyBtn.dataset.perday);
  });
  if (!conv.blocked && conv.orders && conv.orders.primary) wireTaperControls(el);
}

// Reference table of the active factors, generated so it always matches the
// numbers the calculator is actually using.
function renderReferenceTable() {
  const body = document.getElementById('ref-table-body');
  const cap = document.getElementById('ref-table-caption');
  if (!body) return;
  const t = getActiveTable();
  if (cap) cap.textContent = `Active table: ${t.label}. ${t.cite}`;
  const rows = [];
  Object.keys(DRUGS).forEach(drug => {
    const routes = getRoutesForDrug(drug);
    if (!routes.length) {
      rows.push(`<tr><td>${escapeHtml(DRUGS[drug].label)}</td><td>—</td><td>not counted (CDC 2022 footnote 6)</td></tr>`);
      return;
    }
    const byVal = new Map();
    routes.forEach(route => {
      let v;
      if (drug === 'methadone') {
        v = route === 'IV'
          ? '× 2 to oral-equivalent mg (label), then oral factor'
          : (t.label.startsWith('CDC') ? '4.7' : '4 (≤20 mg/day) · 8 (>20–40) · 10 (>40–60) · 12 (>60)');
      } else {
        const rg = getFactorRange(drug, route, 0);
        v = rg.lo === rg.hi ? formatNum(rg.hi) : `${formatNum(rg.lo)}–${formatNum(rg.hi)}`;
        if (drug === 'fentanyl') v += route === 'TD' ? ' per mcg/hr' : ' per mcg';
      }
      if (!byVal.has(v)) byVal.set(v, []);
      byVal.get(v).push(route);
    });
    byVal.forEach((rts, v) => {
      rows.push(`<tr><td>${escapeHtml(DRUGS[drug].label)}</td><td>${escapeHtml(rts.map(x => ROUTE_LABELS[x] || x).join(' / '))}</td><td>${escapeHtml(v)}</td></tr>`);
    });
  });
  body.innerHTML = rows.join('');
}
