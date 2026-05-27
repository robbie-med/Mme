// Settings + patient-context state and localStorage persistence.
// State objects are exported as mutable references; other modules read
// settings.* / patientContext.* directly and call save*() after writes.
//
// Note: the default activeTable is hardcoded as 'cdc' rather than imported
// from tables.js to avoid a circular dep; tables.js imports the live
// `settings` object from here.

export const SETTINGS_KEY = 'mme.settings.v1';
export const LEDGER_KEY   = 'mme.ledger.v1';
export const CONTEXT_KEY  = 'mme.context.v1';

export const settings = {
  defaultView: 'simple',
  persist: true,
  activeTable: 'cdc',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') Object.assign(settings, s);
  } catch (e) { /* ignore corrupt storage */ }
}
export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

// Patient context: never affects MME math, only which alerts fire.
export const patientContext = {
  age: 'unspecified',
  renal: 'unspecified',
  hepatic: 'unspecified',
};

export function saveContext() {
  try {
    if (settings.persist) localStorage.setItem(CONTEXT_KEY, JSON.stringify(patientContext));
    else localStorage.removeItem(CONTEXT_KEY);
  } catch (e) {}
}
export function loadContext() {
  if (!settings.persist) return;
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c && typeof c === 'object') Object.assign(patientContext, c);
  } catch (e) {}
}
export function isContextActive() {
  return patientContext.age !== 'unspecified'
      || patientContext.renal !== 'unspecified'
      || patientContext.hepatic !== 'unspecified';
}
export function clearPatientContext() {
  patientContext.age = 'unspecified';
  patientContext.renal = 'unspecified';
  patientContext.hepatic = 'unspecified';
}
