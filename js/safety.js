// CDC MME risk tiers + drug-specific safety alerts + patient-context layering.
// Pure data functions: callers render the alert objects into the DOM.
import { ledger } from './ledger.js';
import { patientContext } from './settings.js';

export function getRiskTier(mme) {
  if (mme >= 90) return { level: 'high',    label: 'High risk',       explain: '≥90 MME/day' };
  if (mme >= 50) return { level: 'caution', label: 'Caution',         explain: '≥50 MME/day' };
  return                { level: 'low',     label: 'Below threshold', explain: '<50 MME/day' };
}

function addPatientContextAlerts(alerts, totalMME) {
  const elderly = patientContext.age === '65-74' || patientContext.age === '75plus';
  const veryElderly = patientContext.age === '75plus';
  const renalImpaired = ['moderate', 'severe', 'dialysis'].includes(patientContext.renal);
  const renalSevere   = ['severe', 'dialysis'].includes(patientContext.renal);
  const hepaticImpaired = ['moderate', 'severe'].includes(patientContext.hepatic);
  const hepaticSevere   = patientContext.hepatic === 'severe';
  const has = (k) => ledger.some(e => e.drug === k);

  if (elderly && totalMME > 0) {
    alerts.push({
      severity: veryElderly ? 'severe' : 'normal',
      title: `Older adult${veryElderly ? ' (≥75)' : ' (65–74)'}: start low, go slow`,
      body: 'Older adults are more susceptible to opioid-induced sedation, confusion, constipation, and falls. Reduce initial doses ~25–50%, titrate slowly, and reassess function and cognition each visit.',
      cite: 'AGS Beers Criteria; CDC 2022.',
    });
  }
  if (elderly && has('meperidine')) {
    alerts.push({
      severity: 'severe',
      title: 'Older adult + meperidine: Beers Criteria avoid',
      body: 'AGS Beers Criteria specifically recommend against meperidine in older adults due to neurotoxicity risk from normeperidine accumulation. Choose an alternative opioid.',
      cite: 'AGS Beers Criteria 2023.',
    });
  }

  if (renalImpaired) {
    if (has('meperidine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + meperidine: avoid',
        body: 'Normeperidine clearance is renal. Accumulation in CKD or dialysis causes CNS toxicity (myoclonus, seizures). Avoid in this patient.',
        cite: 'KDIGO; Meperidine PI.',
      });
    }
    if (has('morphine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + morphine: accumulation risk',
        body: 'M3G/M6G metabolites accumulate with reduced renal clearance and cause prolonged sedation and respiratory depression. Consider hydromorphone, fentanyl, methadone, or buprenorphine as renal-friendlier alternatives.',
        cite: 'KDIGO; UpToDate.',
      });
    }
    if (has('codeine')) {
      alerts.push({
        severity: 'severe',
        title: 'Renal impairment + codeine: avoid',
        body: 'Codeine and its active metabolite morphine + M6G accumulate with reduced renal clearance. Choose an alternative.',
        cite: 'KDIGO.',
      });
    }
    if (has('tramadol')) {
      alerts.push({
        severity: 'normal',
        title: 'Renal impairment + tramadol: reduce dose',
        body: 'In CrCl <30 mL/min, max 200 mg/day; active metabolite accumulates. Consider 50% dose reduction and extending interval to q12h.',
        cite: 'Tramadol PI.',
      });
    }
  }
  if (renalSevere && has('hydromorphone')) {
    alerts.push({
      severity: 'normal',
      title: 'Severe renal impairment + hydromorphone: monitor',
      body: 'H3G metabolite accumulates but is less neurotoxic than morphine’s M3G. Hydromorphone is generally preferred over morphine in CKD; still reduce dose and extend interval.',
      cite: 'KDIGO.',
    });
  }

  if (hepaticImpaired && totalMME > 0) {
    alerts.push({
      severity: hepaticSevere ? 'severe' : 'normal',
      title: 'Hepatic impairment: reduce dose, prolonged half-life',
      body: 'Most opioids undergo hepatic metabolism. Moderate–severe impairment prolongs half-life and elevates plasma levels. Reduce initial doses (often ~50%) and extend dosing intervals.',
      cite: 'Drug-specific PIs.',
    });
  }
  if (hepaticSevere) {
    const hepAvoid = ['tramadol', 'tapentadol', 'meperidine'].filter(has);
    if (hepAvoid.length) {
      alerts.push({
        severity: 'severe',
        title: `Severe hepatic + ${hepAvoid.join(' / ')}: avoid`,
        body: 'These agents are contraindicated or strongly discouraged in severe hepatic impairment due to unpredictable kinetics (tramadol/tapentadol) or active-metabolite accumulation (meperidine).',
        cite: 'Tramadol/Tapentadol/Meperidine PIs.',
      });
    }
  }
}

export function buildSafetyAlerts(totalMME) {
  const alerts = [];
  if (totalMME >= 50) {
    alerts.push({
      severity: totalMME >= 90 ? 'severe' : 'normal',
      title: 'Consider co-prescribing naloxone',
      body: 'CDC and most pain guidelines recommend offering naloxone to patients on ≥50 MME/day, or with concurrent benzodiazepines, sleep apnea, prior overdose, or substance-use disorder. Counsel the patient and a household contact on use.',
      cite: 'CDC 2022 Clinical Practice Guideline for Prescribing Opioids',
    });
  }
  if (totalMME >= 90) {
    alerts.push({
      severity: 'severe',
      title: 'High-risk dosing: careful review recommended',
      body: 'Doses ≥90 MME/day carry meaningfully higher overdose risk. Reassess goals of pain therapy, check the PMP/PDMP, screen for concurrent sedatives, and consider tapering, adjunctive non-opioid therapies, or specialist input.',
      cite: 'CDC 2022; SAMHSA',
    });
  }
  if (ledger.some(e => e.drug === 'methadone')) {
    alerts.push({
      severity: 'severe',
      title: 'Methadone-specific cautions',
      body: 'Long, highly variable half-life (8–60 h) → delayed steady state (5–7 days) and accumulation risk. Obtain baseline and periodic ECG to monitor QTc; avoid concurrent QT-prolonging drugs. Equianalgesic conversions are non-linear; involve a pain or palliative specialist for opioid-tolerant conversions.',
      cite: 'Methadone PI; CDC; Fudin et al.',
    });
  }
  if (ledger.some(e => e.drug === 'meperidine')) {
    alerts.push({
      severity: 'severe',
      title: 'Meperidine: generally avoid',
      body: 'The metabolite normeperidine accumulates with prolonged use or renal impairment and causes CNS toxicity (tremor, myoclonus, seizures). Most pain guidelines and the AGS Beers Criteria recommend against meperidine for routine analgesia, especially in older adults. Choose an alternative opioid.',
      cite: 'AGS Beers Criteria; ASPMN; APS',
    });
  }
  if (ledger.some(e => e.drug === 'tramadol')) {
    alerts.push({
      severity: 'normal',
      title: 'Tramadol: interaction & seizure cautions',
      body: 'Lowers seizure threshold and can precipitate serotonin syndrome with SSRIs/SNRIs/MAOIs/triptans/linezolid. Analgesic effect depends on CYP2D6 metabolism; ultra-rapid metabolizers and children are at higher risk for sedation/respiratory depression.',
      cite: 'Tramadol PI; FDA Drug Safety Communications',
    });
  }
  if (ledger.some(e => e.drug === 'codeine')) {
    alerts.push({
      severity: 'normal',
      title: 'Codeine: CYP2D6-dependent, avoid in children',
      body: 'Variable CYP2D6 conversion to morphine makes effect unpredictable; ultra-rapid metabolizers are at risk for opioid toxicity. Contraindicated post-tonsillectomy/adenoidectomy in children and in breastfeeding mothers.',
      cite: 'FDA Boxed Warning (2017)',
    });
  }
  if (ledger.some(e => e.drug === 'fentanyl' && e.route === 'TD')) {
    alerts.push({
      severity: 'normal',
      title: 'Fentanyl patch: opioid-naïve contraindication',
      body: 'Transdermal fentanyl is only for opioid-tolerant patients (≥60 mg/day oral morphine equivalent for ≥1 week). Heat (fever, heating pad, hot tub) increases absorption and overdose risk. Residual release continues 12–24 hours after patch removal.',
      cite: 'Duragesic PI',
    });
  }
  addPatientContextAlerts(alerts, totalMME);
  return alerts;
}
