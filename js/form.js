// Quick-add medication form + patient-context dropdown wiring.
import { DRUGS, ROUTE_LABELS, drugUnit } from './drugs.js';
import { getRoutesForDrug } from './tables.js';
import { addManualEntry, addPCAEntry } from './ledger.js';
import {
  patientContext, isContextActive, clearPatientContext, saveContext,
} from './settings.js';

export function populateDrugSelect() {
  document.getElementById('add-drug').innerHTML = Object.keys(DRUGS).map(k =>
    `<option value="${k}">${DRUGS[k].label}</option>`).join('');
}

export function updateRouteOptions() {
  const drug = document.getElementById('add-drug').value;
  if (!DRUGS[drug]) return;
  const routes = getRoutesForDrug(drug);
  const sel = document.getElementById('add-route');
  sel.innerHTML = routes.length
    ? routes.map(r => `<option value="${r}">${ROUTE_LABELS[r] || r}</option>`).join('')
    : `<option value="">(none available)</option>`;
}

export function updateDoseLabels() {
  const drug = document.getElementById('add-drug').value;
  const route = document.getElementById('add-route').value;
  const doseLabel = document.getElementById('dose-label');
  const doseUnitHint = document.getElementById('dose-unit-hint');
  const freqField = document.getElementById('freq-field');
  const freqLabel = document.getElementById('freq-label');
  const freqInput = document.getElementById('add-freq');
  const help = document.getElementById('add-help');
  const u = drugUnit(drug);

  // Update the PCA unit hints too — they share the per-drug unit.
  const pcaBasalUnit = document.getElementById('pca-basal-unit');
  const pcaDemandUnit = document.getElementById('pca-demand-unit');
  if (pcaBasalUnit)  pcaBasalUnit.textContent  = `(${u}/hr)`;
  if (pcaDemandUnit) pcaDemandUnit.textContent = `(${u})`;

  if (drug === 'fentanyl' && route === 'TD') {
    doseLabel.firstChild.textContent = 'Patch rate ';
    doseUnitHint.textContent = '(mcg/hr)';
    freqField.style.display = 'none'; freqInput.value = 1;
    help.textContent = 'Enter the patch strength (e.g. 25 for a 25 mcg/hr patch). Steady-state assumed.';
  } else if (drug === 'fentanyl' && route === 'IV') {
    doseLabel.firstChild.textContent = 'Dose per administration ';
    doseUnitHint.textContent = '(mcg)';
    freqField.style.display = ''; freqLabel.textContent = 'Doses per day';
    help.textContent = 'For a continuous infusion, enter mcg/hr in "Dose" and 24 in "Doses per day".';
  } else if (drug === 'methadone' && route === 'PO') {
    doseLabel.firstChild.textContent = 'Dose per administration ';
    doseUnitHint.textContent = '(mg)';
    freqField.style.display = ''; freqLabel.textContent = 'Doses per day';
    help.textContent = 'Chronic dosing assumed — tiered methadone factor applied to total daily mg.';
  } else {
    doseLabel.firstChild.textContent = 'Dose per administration ';
    doseUnitHint.textContent = `(${u})`;
    freqField.style.display = ''; freqLabel.textContent = 'Doses per day';
    help.textContent = '';
  }
}

export function getAddMode() {
  const checked = document.querySelector('input[name="add-mode"]:checked');
  return checked ? checked.value : 'scheduled';
}

export function applyAddMode() {
  const mode = getAddMode();
  const form = document.querySelector('.add-form');
  if (form) form.setAttribute('data-mode', mode);
}

export function handleAdd() {
  const drug = document.getElementById('add-drug').value;
  const route = document.getElementById('add-route').value;
  if (!route) { flashHelp('Select a route.'); return; }
  const mode = getAddMode();
  if (mode === 'pca') {
    const basal   = parseFloat(document.getElementById('pca-basal').value);
    const demand  = parseFloat(document.getElementById('pca-demand').value);
    const demands = parseFloat(document.getElementById('pca-demands').value);
    const lockout = parseFloat(document.getElementById('pca-lockout').value) || 0;
    const basalOK   = isFinite(basal)   && basal   >= 0;
    const demandOK  = isFinite(demand)  && demand  >= 0;
    const demandsOK = isFinite(demands) && demands >= 0;
    if (!(basalOK && demandOK && demandsOK)) {
      flashHelp('Enter non-negative basal, demand, and demands/day.'); return;
    }
    if (basal === 0 && demand === 0) {
      flashHelp('Either basal or demand must be greater than 0.'); return;
    }
    addPCAEntry({ drug, route, basal, demand, demands, lockout });
    document.getElementById('pca-basal').value = '';
    document.getElementById('pca-demand').value = '';
    document.getElementById('pca-basal').focus();
    return;
  }
  const dose = parseFloat(document.getElementById('add-dose').value);
  const perDay = parseFloat(document.getElementById('add-freq').value) || 1;
  if (!isFinite(dose) || dose <= 0) { flashHelp('Enter a dose greater than 0.'); return; }
  addManualEntry({ drug, route, dose, perDay });
  document.getElementById('add-dose').value = '';
  document.getElementById('add-dose').focus();
}

export function flashHelp(msg) {
  const el = document.getElementById('add-help');
  const prev = el.textContent;
  el.textContent = msg; el.style.color = '#b91c1c';
  setTimeout(() => { el.textContent = prev; el.style.color = ''; }, 2200);
}

function humanizeAge(a) {
  return ({ 'under65': '<65', '65-74': '65–74', '75plus': '≥75' })[a] || a;
}

export function applyContextToUI() {
  const map = { age: 'ctx-age', renal: 'ctx-renal', hepatic: 'ctx-hepatic' };
  for (const key in map) {
    const el = document.getElementById(map[key]);
    if (el) el.value = patientContext[key];
  }
  const chip = document.getElementById('ctx-active-chip');
  if (chip) {
    if (isContextActive()) {
      const parts = [];
      if (patientContext.age !== 'unspecified')     parts.push(humanizeAge(patientContext.age));
      if (patientContext.renal !== 'unspecified')   parts.push('renal: ' + patientContext.renal);
      if (patientContext.hepatic !== 'unspecified') parts.push('hepatic: ' + patientContext.hepatic);
      chip.hidden = false;
      chip.textContent = 'Active · ' + parts.join(' · ');
    } else {
      chip.hidden = true;
      chip.textContent = '';
    }
  }
}

export function wirePatientContext(onChange) {
  const map = { age: 'ctx-age', renal: 'ctx-renal', hepatic: 'ctx-hepatic' };
  for (const key in map) {
    const el = document.getElementById(map[key]);
    if (!el) continue;
    el.addEventListener('change', e => {
      patientContext[key] = e.target.value;
      saveContext();
      applyContextToUI();
      onChange();
    });
  }
  const clearBtn = document.getElementById('ctx-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearPatientContext();
    saveContext();
    applyContextToUI();
    onChange();
  });
}
