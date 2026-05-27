// Quick-add medication form + patient-context dropdown wiring.
import { DRUGS, ROUTE_LABELS, drugUnit } from './drugs.js';
import { getRoutesForDrug } from './tables.js';
import { addManualEntry } from './ledger.js';
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

export function handleAdd() {
  const drug = document.getElementById('add-drug').value;
  const route = document.getElementById('add-route').value;
  const dose = parseFloat(document.getElementById('add-dose').value);
  const perDay = parseFloat(document.getElementById('add-freq').value) || 1;
  if (!isFinite(dose) || dose <= 0) { flashHelp('Enter a dose greater than 0.'); return; }
  if (!route) { flashHelp('Select a route.'); return; }
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
