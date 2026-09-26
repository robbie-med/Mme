// MME risk tiers + drug-specific safety alerts + patient-context layering.
// Pure data functions: callers render the alert objects into the DOM.
// Wording and thresholds are taken from the cited source (README "Sources").
import { ledger } from './ledger.js';
import { patientContext } from './settings.js';

// CDC 2022 Rec 4: at ≥50 MME/day pause and reassess, add precautions and
// offer naloxone; it sets no fixed upper ceiling. 90 MME/day was the 2016
// guideline's "avoid or carefully justify" threshold and is still widely used
// (e.g. PDMP reports), so it is kept as a labelled tier.
export function getRiskTier(mme) {
  if (mme >= 90) return { level: 'high',    label: 'High dosage',     explain: '≥90 MME/day' };
  if (mme >= 50) return { level: 'caution', label: 'Caution',         explain: '≥50 MME/day' };
  return                { level: 'low',     label: 'Below 50',        explain: '<50 MME/day' };
}

const has = (k) => ledger.some(e => e.drug === k);

function addPatientContextAlerts(alerts, totalMME, ctx) {
  const elderly = ctx.age === '65-74' || ctx.age === '75plus';
  const veryElderly = ctx.age === '75plus';
  const renalImpaired = ['moderate', 'severe', 'dialysis'].includes(ctx.renal);
  const renalSevere   = ['severe', 'dialysis'].includes(ctx.renal);
  const hepaticImpaired = ['moderate', 'severe'].includes(ctx.hepatic);
  const hepaticSevere   = ctx.hepatic === 'severe';

  if (elderly && totalMME > 0) {
    alerts.push({
      severity: veryElderly ? 'severe' : 'normal',
      title: `Older adult${veryElderly ? ' (≥75)' : ' (65–74)'}: extra caution`,
      body: 'CDC 2022 advises additional caution when initiating opioids for patients aged ≥65 because of a potentially smaller therapeutic window between safe dosages and dosages associated with respiratory depression and overdose. Titrate slowly and reassess function and cognition.',
      cite: 'CDC 2022 Rec 4 and Rec 8.', refs: ['cdc2022'],
    });
  }
  if (veryElderly && has('tramadol')) {
    alerts.push({
      severity: 'normal',
      title: 'Age >75 + tramadol: maximum 300 mg/day',
      body: 'Do not exceed a total dose of 300 mg/day in patients over 75 years old.',
      cite: 'Tramadol HCl tablets label §2.', refs: ['lblTramadol'],
    });
  }
  if (elderly && has('meperidine')) {
    alerts.push({
      severity: 'severe',
      title: 'Older adult + meperidine: avoid',
      body: 'Multiple doses of meperidine are contraindicated in the elderly because the neurotoxic metabolite normeperidine accumulates. Choose an alternative opioid.',
      cite: 'UofT Opioid Equianalgesic Table (2014), meperidine comments.', refs: ['uoft'],
    });
  }

  if (renalImpaired) {
    if (has('meperidine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + meperidine: avoid',
        body: 'Normeperidine is renally excreted and accumulates in renal impairment, causing confusion, twitching and seizures. Multiple doses are contraindicated in renal insufficiency (UofT equianalgesic chart).',
        cite: 'UofT Opioid Equianalgesic Table (2014), meperidine comments.', refs: ['uoft'],
      });
    }
    if (has('morphine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + morphine: accumulation risk',
        body: 'Active metabolites accumulate with reduced renal clearance and cause prolonged sedation and respiratory depression. Hydromorphone is preferred in renal disease (UofT chart).',
        cite: 'UofT Opioid Equianalgesic Table (2014); CDC 2022 Rec 8.', refs: ['uoft', 'cdc2022'],
      });
    }
    if (has('codeine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + codeine: avoid',
        body: 'Codeine is converted to morphine; morphine and its metabolites accumulate with reduced renal clearance. Choose an alternative.',
        cite: 'CDC 2022 Rec 8.', refs: ['cdc2022'],
      });
    }
  }
  if (renalSevere && has('tramadol')) {
    alerts.push({
      severity: 'normal',
      title: 'CrCl <30 + tramadol: q12h, max 200 mg/day',
      body: 'In creatinine clearance below 30 mL/min, increase the dosing interval to 12 hours with a maximum daily dose of 200 mg. Tramadol ER should not be used in severe renal impairment.',
      cite: 'Tramadol HCl tablets and ER capsules labels.', refs: ['lblTramadol', 'lblTramadolER'],
    });
  }
  if (renalImpaired || hepaticImpaired) {
    if (has('hydromorphone')) {
      alerts.push({
        severity: 'normal',
        title: 'Organ impairment + hydromorphone: start at ¼–½ dose',
        body: 'Start patients with renal or hepatic impairment on one-fourth to one-half of the usual starting dose, depending on severity.',
        cite: 'Dilaudid injection label §2.3–2.4.', refs: ['lblDilaudidInj'],
      });
    }
  }

  if (hepaticImpaired && totalMME > 0) {
    alerts.push({
      severity: hepaticSevere ? 'severe' : 'normal',
      title: 'Hepatic impairment: reduce dose, extend interval',
      body: 'Decreased clearance can cause accumulation to toxic levels. Use additional caution and consider a longer dosing interval, especially with ER/LA opioids.',
      cite: 'CDC 2022 Rec 3 and Rec 8.', refs: ['cdc2022'],
    });
  }
  if (hepaticSevere) {
    const hepAvoid = ['tramadol', 'tapentadol'].filter(has);
    if (hepAvoid.length) {
      alerts.push({
        severity: 'severe',
        title: `Severe hepatic impairment + ${hepAvoid.join(' / ')}: not recommended`,
        body: 'Tapentadol is not recommended in severe hepatic impairment (Child-Pugh 10–15). Tramadol ER should not be used in severe hepatic impairment.',
        cite: 'Nucynta tablets label; tramadol ER capsules label §8.6.', refs: ['lblNucynta', 'lblTramadolER'],
      });
    }
    if (ledger.some(e => e.drug === 'fentanyl' && e.route === 'TD')) {
      alerts.push({
        severity: 'severe',
        title: 'Severe hepatic impairment + fentanyl patch: avoid',
        body: 'Because of the long half-life of transdermal fentanyl and its hepatic metabolism, avoid use in severe hepatic impairment.',
        cite: 'Fentanyl transdermal system label §8.', refs: ['lblFentanylTD'],
      });
    }
  }
  if (renalSevere && ledger.some(e => e.drug === 'fentanyl' && e.route === 'TD')) {
    alerts.push({
      severity: 'severe',
      title: 'Severe renal impairment + fentanyl patch: avoid',
      body: 'Because of the long half-life of transdermal fentanyl, avoid use in patients with severe renal impairment.',
      cite: 'Fentanyl transdermal system label §8.', refs: ['lblFentanylTD'],
    });
  }
}

export function buildSafetyAlerts(totalMME, ctx = patientContext) {
  const alerts = [];
  const riskFactors = [];
  if (totalMME >= 50) riskFactors.push('≥50 MME/day');
  if (ctx.benzo) riskFactors.push('concurrent benzodiazepine');
  if (ctx.sleepApnea) riskFactors.push('sleep-disordered breathing');
  if (ctx.odHistory) riskFactors.push('history of overdose or substance use disorder');
  if (riskFactors.length && (totalMME > 0 || ledger.length)) {
    alerts.push({
      severity: totalMME >= 90 || riskFactors.length > 1 ? 'severe' : 'normal',
      title: 'Offer naloxone',
      body: `Risk factor${riskFactors.length > 1 ? 's' : ''} present: ${riskFactors.join('; ')}. CDC 2022: offer naloxone when prescribing opioids, particularly to patients with a history of overdose or substance use disorder, sleep-disordered breathing, higher dosages (e.g., ≥50 MME/day), or concurrent benzodiazepines, and provide overdose education to the patient and household members.`,
      cite: 'CDC 2022 Rec 8.', refs: ['cdc2022'],
    });
  }
  if (totalMME >= 50) {
    alerts.push({
      severity: totalMME >= 90 ? 'severe' : 'normal',
      title: totalMME >= 90 ? 'High dosage: careful review' : '≥50 MME/day: pause and reassess',
      body: 'CDC 2022: before increasing to ≥50 MME/day, pause and carefully reassess benefits and risks; at or above 50 MME/day add precautions such as more frequent follow-up. Increases beyond 50 MME/day are progressively more likely to yield diminishing returns. In observational studies, ≥100 MME/day was associated with 2.0–8.9 times the overdose risk of 1 to <20 MME/day. Check the PDMP.',
      cite: 'CDC 2022 Rec 4 and supporting rationale.', refs: ['cdc2022'],
    });
  }
  if (ctx.benzo) {
    alerts.push({
      severity: 'severe',
      title: 'Opioid + benzodiazepine',
      body: 'CDC 2022 advises particular caution when prescribing benzodiazepines or other sedating medications with opioid pain medication.',
      cite: 'CDC 2022 Rec 11.', refs: ['cdc2022'],
    });
  }
  if (has('methadone')) {
    alerts.push({
      severity: 'severe',
      title: 'Methadone-specific cautions',
      body: 'Plasma elimination half-life 8–59 h; steady state takes at least 3–5 days. Potency relative to other opioids is nonlinear and increases with dose, and its conversion table cannot be used in reverse. Assess QT prolongation risk and consider ECG monitoring. Involve a pain or palliative specialist for conversions.',
      cite: 'Methadone HCl tablets label §2.4; CDC 2022 Rec 3.', refs: ['lblMethadone', 'cdc2022'],
    });
  }
  if (has('meperidine')) {
    alerts.push({
      severity: 'severe',
      title: 'Meperidine: generally avoid',
      body: 'Normeperidine has half the analgesic potency of meperidine but 2–3 times the neurotoxic potential. Risk increases above 600 mg/24 h or beyond 48 hours of use. Not recommended for chronic use.',
      cite: 'UofT Opioid Equianalgesic Table (2014).', refs: ['uoft'],
    });
  }
  if (has('tramadol')) {
    alerts.push({
      severity: 'normal',
      title: 'Tramadol: seizure and serotonin syndrome risk',
      body: 'Lowers seizure threshold and can cause serotonin syndrome with serotonergic drugs. Analgesia depends on CYP2D6 metabolism. Do not exceed 400 mg/day (IR) or 300 mg/day (ER).',
      cite: 'Tramadol HCl tablets and ER capsules labels.', refs: ['lblTramadol', 'lblTramadolER'],
    });
  }
  if (has('codeine')) {
    alerts.push({
      severity: 'normal',
      title: 'Codeine: CYP2D6-dependent',
      body: 'Conversion to morphine varies with CYP2D6 genotype; ultra-rapid metabolizers are at risk of toxicity. Maximum 360 mg per 24 hours.',
      cite: 'Codeine sulfate tablets label.', refs: ['lblCodeine'],
    });
  }
  if (ledger.some(e => e.drug === 'fentanyl' && e.route === 'TD')) {
    alerts.push({
      severity: 'normal',
      title: 'Fentanyl patch: opioid-tolerant patients only',
      body: 'Opioid-tolerant means at least 60 mg oral morphine/day (or 30 mg oxycodone, 8 mg hydromorphone, 25 mcg/hr fentanyl, or equivalent) for one week or longer. After removal, serum fentanyl falls only about 50% in 20–27 hours. Heat increases absorption.',
      cite: 'Fentanyl transdermal system label §1, §12.3.', refs: ['lblFentanylTD'],
    });
  }
  const mixed = ['nalbuphine', 'butorphanol'].filter(has);
  const fullAgonist = ledger.some(e => !['nalbuphine', 'butorphanol', 'buprenorphine'].includes(e.drug));
  if (mixed.length && fullAgonist) {
    alerts.push({
      severity: 'severe',
      title: `${mixed.join(' / ')} with a full agonist`,
      body: 'Mixed agonist/antagonists given to patients receiving full opioid agonists may reduce analgesia and precipitate withdrawal. Avoid the combination.',
      cite: 'Nalbuphine injection and butorphanol nasal spray labels.', refs: ['lblNalbuphine', 'lblButorphanol'],
    });
  }
  if (has('buprenorphine')) {
    alerts.push({
      severity: 'normal',
      title: 'Buprenorphine is not counted in MME',
      body: 'Buprenorphine products are excluded from the CDC MME table because of partial µ-agonist activity and ceiling effects. Its contribution is not reflected in the total.',
      cite: 'CDC 2022 Table, footnote 6.', refs: ['cdc2022'],
    });
  }
  addPatientContextAlerts(alerts, totalMME, ctx);
  return alerts;
}
