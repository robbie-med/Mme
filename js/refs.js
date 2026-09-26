// Reference registry: every source the calculator cites, with a working URL.
// All URLs were checked on 2026-09-26. FDA labels link to DailyMed (the
// National Library of Medicine's label repository) by SPL set ID.
import { escapeHtml } from './util.js';

const dailymed = setid => `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`;

export const REFS = {
  cdc2022: {
    short: 'CDC 2022 guideline',
    title: 'Dowell D, et al. CDC Clinical Practice Guideline for Prescribing Opioids for Pain — United States, 2022. MMWR Recomm Rep 2022;71(No. RR-3):1–95.',
    url: 'https://www.cdc.gov/mmwr/volumes/71/rr/rr7103a1.htm',
    alt: { label: 'PubMed Central copy', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9639433/' },
  },
  cms2017: {
    short: 'CMS MME conversion factors',
    title: 'CMS. Opioid Oral Morphine Milligram Equivalent (MME) Conversion Factors (CDC compilation, 2017 version). HHS Guidance Portal.',
    url: 'https://www.hhs.gov/guidance/document/opioid-oral-morphine-milligram-equivalent-mme-conversion-factors-0',
    alt: { label: 'PDF of the CMS table (Utah Medicaid copy)', url: 'https://medicaid-documents.dhhs.utah.gov/Documents/files/Opioid-Morphine-EQ-Conversion-Factors.pdf' },
  },
  uoft: {
    short: 'UofT equianalgesic table',
    title: 'University of Toronto, Department of Surgery. Opioid Equianalgesic Table (November 2014).',
    url: 'https://surgery.utoronto.ca/sites/default/files/Opioid%20Equianalgesic%20Chart%20Nov%202014.pdf',
  },
  aps2014: {
    short: 'APS methadone safety guideline',
    title: 'Chou R, et al. Methadone safety: a clinical practice guideline from the American Pain Society and College on Problems of Drug Dependence, in collaboration with the Heart Rhythm Society. J Pain 2014;15(4):321–37.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/24685458/',
    alt: { label: 'doi:10.1016/j.jpain.2014.01.494', url: 'https://doi.org/10.1016/j.jpain.2014.01.494' },
  },
  myers2008: {
    short: 'Myers & Shetty 2008',
    title: 'Myers J, Shetty N. Going beyond efficacy: strategies for cancer pain management. Curr Oncol 2008;15(Suppl 1):S41–S49.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2216422/',
  },
  // FDA prescribing information (DailyMed)
  lblFentanylTD:   { short: 'Fentanyl transdermal label', title: 'Fentanyl transdermal system, FDA prescribing information (DailyMed).', url: dailymed('e15a7e9b-8025-49dd-9a6d-bafcccf1959f') },
  lblMethadone:    { short: 'Methadone tablets label', title: 'Methadone hydrochloride tablets, FDA prescribing information (DailyMed).', url: dailymed('eddf7077-02fb-4771-9823-31984f4ff2bb') },
  lblDilaudidInj:  { short: 'Dilaudid injection label', title: 'Dilaudid (hydromorphone HCl) injection, FDA prescribing information (DailyMed).', url: dailymed('9eebd88a-5632-460f-b7b6-26c8a180540d') },
  lblHydromorphER: { short: 'Hydromorphone ER label', title: 'Hydromorphone HCl extended-release tablets, FDA prescribing information (DailyMed).', url: dailymed('780a2616-0392-4715-bc50-71799bea1957') },
  lblOxycontin:    { short: 'OxyContin label', title: 'OxyContin (oxycodone HCl) extended-release tablets, FDA prescribing information (DailyMed).', url: dailymed('bfdfe235-d717-4855-a3c8-a13d26dadede') },
  lblMorphineER:   { short: 'Morphine ER label', title: 'Morphine sulfate extended-release tablets, FDA prescribing information (DailyMed).', url: dailymed('533034fd-c8e7-495b-8874-0db41bd1e65a') },
  lblHysingla:     { short: 'Hysingla ER label', title: 'Hysingla ER (hydrocodone bitartrate) extended-release tablets, FDA prescribing information (DailyMed).', url: dailymed('b7d23ac2-e776-9f62-3290-c64c2d6eb353') },
  lblOxymorphER:   { short: 'Oxymorphone ER label', title: 'Oxymorphone HCl extended-release tablets, FDA prescribing information (DailyMed).', url: dailymed('3f4e703a-e398-42fd-8759-e398c79955f1') },
  lblNucynta:      { short: 'Nucynta label', title: 'Nucynta (tapentadol) tablets, FDA prescribing information (DailyMed).', url: dailymed('80938c30-9fe3-4c7d-9d9c-5476638cfb2d') },
  lblNucyntaER:    { short: 'Nucynta ER label', title: 'Nucynta ER (tapentadol) extended-release tablets, FDA prescribing information (DailyMed).', url: dailymed('c3d04d70-0155-4147-9ce4-a3b1fad4b373') },
  lblTramadol:     { short: 'Tramadol tablets label', title: 'Tramadol HCl tablets, FDA prescribing information (DailyMed).', url: dailymed('8ec4e4e5-a56e-4198-8428-6b770b9bf27d') },
  lblTramadolER:   { short: 'Tramadol ER label', title: 'Tramadol HCl extended-release capsules, FDA prescribing information (DailyMed).', url: dailymed('c0bc7218-3fd0-4646-96f4-25355fc84aa9') },
  lblCodeine:      { short: 'Codeine sulfate label', title: 'Codeine sulfate tablets, FDA prescribing information (DailyMed).', url: dailymed('5819bdf7-300e-45b8-8f3a-447b53656293') },
  lblNalbuphine:   { short: 'Nalbuphine label', title: 'Nalbuphine HCl injection, FDA prescribing information (DailyMed).', url: dailymed('a99fe500-f52b-483c-807c-178f1a78a02b') },
  lblButorphanol:  { short: 'Butorphanol nasal spray label', title: 'Butorphanol tartrate nasal spray, FDA prescribing information (DailyMed).', url: dailymed('b8e48063-0b40-ee43-85c1-4ef2de80c404') },
  lblHydrocodoneApap: { short: 'Hydrocodone/acetaminophen label', title: 'Hydrocodone bitartrate and acetaminophen, FDA prescribing information (DailyMed).', url: dailymed('995a6cc7-8b72-4d35-b3b4-8c5752438fb7') },
};

// Label reference for each ER product in the conversion engine.
export const ER_LABEL_REF = {
  morphine: 'lblMorphineER', oxycodone: 'lblOxycontin', oxymorphone: 'lblOxymorphER',
  hydromorphone: 'lblHydromorphER', hydrocodone: 'lblHysingla', tapentadol: 'lblNucyntaER',
  tramadol: 'lblTramadolER',
};

function uniq(keys) { return Array.from(new Set((keys || []).filter(k => REFS[k]))); }

// Inline list of short links, e.g. for under an alert or a conversion.
export function refLinksHtml(keys) {
  const ks = uniq(keys);
  if (!ks.length) return '';
  return ks.map(k => `<a href="${escapeHtml(REFS[k].url)}" target="_blank" rel="noopener" title="${escapeHtml(REFS[k].title)}">${escapeHtml(REFS[k].short)}</a>`).join(' · ');
}

// Full bibliography entries as HTML list items.
export function refListHtml(keys) {
  return uniq(keys).map(k => {
    const r = REFS[k];
    const alt = r.alt ? ` (<a href="${escapeHtml(r.alt.url)}" target="_blank" rel="noopener">${escapeHtml(r.alt.label)}</a>)` : '';
    return `<li>${escapeHtml(r.title)} <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>${alt}</li>`;
  }).join('');
}

// Plain-text lines for the copied note.
export function refTextLines(keys) {
  return uniq(keys).map(k => `  - ${REFS[k].title} ${REFS[k].url}`);
}
