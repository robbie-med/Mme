// All DOM rendering: simple cards, complex table, totals, safety alerts,
// conversion result, derivation panels, warnings. Subscribers in main.js call
// render() whenever ledger/view/settings state changes.
import { DRUGS, ROUTE_LABELS, drugUnit } from './drugs.js';
import { getActiveTable, getFactor } from './tables.js';
import { computeEntryMME, formatNum, formatDate } from './mme.js';
import { ledger, removeEntry } from './ledger.js';
import { view, expandedRows, viewState, setTotalExpanded } from './views.js';
import { getRiskTier, buildSafetyAlerts } from './safety.js';
import {
  buildConversionOrders, renderConversionOrders, buildBeforeAfter,
  applyProposedRegimen, computeTargetDose,
} from './conversion.js';
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
  const tablePart = `${t.label}: ${t.cite}`;
  if (entry.drug === 'methadone' && entry.route === 'PO')
    return `${tablePart} Methadone PI; Fudin et al.`;
  if (entry.drug === 'fentanyl' && entry.route === 'TD')
    return `${tablePart} Duragesic PI; Donner et al. Pain 1996 (25 mcg/hr ≈ 60 MME).`;
  if (entry.drug === 'fentanyl')
    return `${tablePart} Fentanyl IV 100 mcg ≈ morphine IV 10 mg ≈ morphine PO 30 mg (chronic).`;
  return tablePart;
}

function buildDerivation(r) {
  const e = r.entry;
  const drugLabel = DRUGS[e.drug] ? DRUGS[e.drug].label : e.drug;
  const u = drugUnit(e.drug);
  const parts = [];
  parts.push(`<div class="d-step"><span class="d-label">Medication</span><span class="d-value">${escapeHtml(drugLabel)} ${escapeHtml(ROUTE_LABELS[e.route] || e.route)} <span class="source-tag ${e.source}">${e.source}</span></span></div>`);
  if (e.source === 'manual') {
    parts.push(`<div class="d-step"><span class="d-label">Entered as</span><span class="d-value">${escapeHtml(e.label || '')}</span></div>`);
  } else if (r.kept.length > 0) {
    const adminLines = r.kept.slice(0, 30).map(a =>
      `<div>${formatDate(a.ts)} &middot; ${formatNum(a.dose)} ${a.unit}</div>`).join('');
    parts.push(`<div class="d-step"><span class="d-label">Doses in window</span><span class="d-value">${r.kept.length} dose${r.kept.length===1?'':'s'} · sum ${formatNum(r.totalDose)} ${u}<div class="d-admins">${adminLines}${r.kept.length>30?'<div>…</div>':''}</div></span></div>`);
  } else {
    parts.push(`<div class="d-step"><span class="d-label">Doses in window</span><span class="d-value">0 — entry contributes 0 MME for this window</span></div>`);
  }
  if (r.spanHours != null && r.spanHours > 24 && r.normalizedDaily !== r.totalDose) {
    parts.push(`<div class="d-step"><span class="d-label">Normalized</span><span class="d-value">${formatNum(r.totalDose)} ${u} × 24 / ${r.spanHours.toFixed(1)} h = <strong>${formatNum(r.normalizedDaily)} ${u}/day</strong></span></div>`);
  } else if (r.kept.length > 0 && !(e.drug === 'fentanyl' && e.route === 'TD')) {
    parts.push(`<div class="d-step"><span class="d-label">Daily dose</span><span class="d-value"><strong>${formatNum(r.normalizedDaily)} ${u}/day</strong></span></div>`);
  }
  parts.push(`<div class="d-step"><span class="d-label">Calculation</span><span class="d-value">${escapeHtml(r.factorDescription || '—')}</span></div>`);
  parts.push(`<div class="d-step d-result"><span class="d-label">MME / day</span><span class="d-value"><strong>${r.mme == null ? '—' : formatNum(r.mme)}</strong></span></div>`);
  parts.push(`<div class="d-cite">${citationFor(e)}</div>`);
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

export function getRowsForActiveView() {
  let windowHours = '24', anchorMode = 'latest';
  if (view.current === 'complex') {
    windowHours = document.getElementById('time-window').value;
    anchorMode = document.getElementById('window-anchor').value;
  }
  let anchorTs;
  if (anchorMode === 'now') {
    anchorTs = Date.now();
  } else {
    const allTs = ledger.flatMap(e => e.admins.map(a => a.ts));
    anchorTs = allTs.length ? Math.max(...allTs) : Date.now();
  }
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
  renderConversion(totalMME);
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
    const u = drugUnit(e.drug);
    const srcTag = `<span class="source-tag ${e.source}">${e.source}</span>`;
    let detail = e.label || '';
    if (e.source === 'parsed' && r.kept.length) {
      detail = r.kept.slice(0, 5).map(a => formatDate(a.ts) + ' · ' + formatNum(a.dose) + a.unit).join(' | ') +
        (r.kept.length > 5 ? ' …' : '');
    }
    trs.push(`<tr data-id="${e.id}">
      <td><div><strong>${escapeHtml(drug)}</strong> ${srcTag}</div>
        <div class="admin-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div></td>
      <td><span class="tag ${routeClass}">${e.route}</span></td>
      <td class="num">${r.kept.length}</td>
      <td class="num">${formatNum(r.totalDose)} ${u}</td>
      <td class="num">${formatNum(r.normalizedDaily)} ${u}</td>
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
        <th class="num">Doses (window)</th><th class="num">Total (window)</th>
        <th class="num">Normalized / day</th><th>Calc</th>
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
  rows.forEach(r => {
    if (r.mme == null) items.push(`No factor for ${DRUGS[r.entry.drug].label} (${r.entry.route}) — excluded from total.`);
    if (r.entry.drug === 'methadone' && r.kept.length > 0) items.push('Methadone conversions are highly variable. Confirm dose with a pain or palliative specialist.');
    if (r.entry.drug === 'fentanyl' && r.entry.route === 'TD' && r.entry.source === 'parsed')
      items.push('Fentanyl patch dose treated as continuous mcg/hr (latest value in window).');
  });
  if (!items.length) { el.innerHTML = ''; return; }
  const uniq = Array.from(new Set(items));
  el.innerHTML = '<div class="warning"><strong>Notes</strong><ul>' + uniq.map(t => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div>';
}

function renderTotals(rows, totalMME) {
  document.getElementById('total-mme').textContent = formatNum(totalMME);
  let windowLabel = 'last 24 h';
  if (view.current === 'complex') {
    const w = document.getElementById('time-window').value;
    windowLabel = w === 'all' ? 'all administrations (normalized to 24 h)' : `last ${w} h`;
  }
  const drugCount = rows.filter(r => r.mme && r.mme > 0).length;
  const tableLabel = getActiveTable().label;
  document.getElementById('totals-detail').textContent =
    `Sum across ${drugCount} medication${drugCount === 1 ? '' : 's'} · window: ${windowLabel} · via ${tableLabel}`;

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

function renderConversion(totalMME) {
  const el = document.getElementById('conversion-result');
  if (!totalMME || totalMME <= 0) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const target = document.getElementById('target-drug').value;
  if (!target) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const [drugKey, route] = target.split('|');
  const reduction = Number(document.getElementById('reduction').value) / 100;
  const adjMME = totalMME * (1 - reduction);
  const tc = computeTargetDose(drugKey, route, adjMME);
  if (!tc) {
    el.classList.add('show');
    el.innerHTML = '<strong>No conversion factor</strong> available for this target.';
    return;
  }
  const drugLabel = DRUGS[drugKey].label;
  const reductionText = reduction > 0
    ? `Applied ${(reduction * 100).toFixed(0)}% cross-tolerance reduction (${formatNum(totalMME)} → ${formatNum(adjMME)} MME).`
    : 'No cross-tolerance reduction applied.';
  const orders = buildConversionOrders(drugKey, route, tc.dose, adjMME);
  const currentRows = getRowsForActiveView();
  const currentTotal = currentRows.reduce((s, r) => s + (r.mme || 0), 0);
  el.classList.add('show');
  el.innerHTML = `<div>Equivalent dose of <strong>${escapeHtml(drugLabel)}</strong>:</div>
    <div class="target-dose">${formatNum(tc.dose)} ${escapeHtml(tc.unit)}</div>
    <div class="breakdown">${escapeHtml(tc.calcDesc)}<br>${escapeHtml(reductionText)}</div>
    ${renderConversionOrders(orders)}
    ${buildBeforeAfter(currentRows, currentTotal, orders)}`;
  const applyBtn = el.querySelector('#apply-regimen-btn');
  if (applyBtn) applyBtn.addEventListener('click', () => {
    applyProposedRegimen(applyBtn.dataset.drug, applyBtn.dataset.route,
                         applyBtn.dataset.dose, applyBtn.dataset.perday);
  });
}
