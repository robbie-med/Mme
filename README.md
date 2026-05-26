# MME Calculator

A single-page opioid Morphine Milligram Equivalent (MME) calculator that handles
both simple regimens and complex multi-drug, multi-order inpatient records.
Designed for clinicians who want to total up a patient's daily MME from a mix
of home medications and EHR medication-administration data, then convert that
total to an equivalent dose of a different opioid.

**Live version:** enable GitHub Pages from `main` → root and visit
`https://<your-user>.github.io/<repo>/`.

## Features

- **Unified medication ledger.** Every medication — whether typed in or parsed
  from a pasted MAR — lands in the same list, totals into the same MME, and is
  individually removable.
- **Smart quick-add form.** Drug selector filters routes to what's actually
  valid for that drug. Labels and units adapt: fentanyl patch shows
  `Patch rate (mcg/hr)` with no per-day field, fentanyl IV switches to mcg,
  methadone surfaces a tiered-factor hint.
- **MAR paste parser.** Drops in directly from an EHR medication-administration
  block. Handles multi-order blocks (including `or`-prefixed follow-on orders
  and unprefixed strength changes), pulls the route from brand names and order
  text (`Tab` → PO, `0.25 mL, IV` → IV, `mcg/hr` → transdermal), and ignores
  free-text PRN comments while scanning for date / time / dose triplets.
- **Time-window aware.** Default window is the last 24 hours, anchored at the
  latest dose found in the data (or the current clock, your choice). Also
  supports 48 h / 72 h / "all administrations normalized to 24 h" for orders
  that span several days.
- **Target conversion.** Pick a destination opioid (PO, IV/IM/SC, transdermal,
  or chronic PO methadone) and apply an optional cross-tolerance reduction
  (25% / 33% / 50%) to get the equivalent dose. Methadone outbound uses the
  GlobalRPh tiered ratio appropriate for the total MME.
- **No build step, no backend.** Three static files. Open `index.html` in any
  browser, or host it on GitHub Pages.

## Conversion factors

Factors come from the GlobalRPh equianalgesic table with oral morphine = 30 mg
chronic baseline and IV morphine = 10 mg. Methadone PO uses CDC tiered factors
for inbound (drug → MME) conversion and the GlobalRPh tiered ratio for outbound
(MME → methadone) conversion.

| Drug             | Route              | MME / mg      |
|------------------|--------------------|---------------|
| Morphine         | PO                 | 1             |
| Morphine         | IV / IM / SC       | 3             |
| Hydromorphone    | PO                 | 4             |
| Hydromorphone    | IV / IM / SC       | 20            |
| Oxycodone        | PO                 | 1.5           |
| Oxymorphone      | PO                 | 3             |
| Oxymorphone      | IV / IM / SC       | 30            |
| Hydrocodone      | PO                 | 1             |
| Codeine          | PO                 | 0.15          |
| Codeine          | IV / IM / SC       | 0.25          |
| Tramadol         | PO                 | 0.1           |
| Tapentadol       | PO                 | 0.4           |
| Meperidine       | PO                 | 0.1           |
| Meperidine       | IV / IM / SC       | 0.4           |
| Fentanyl         | IV / IM (per mcg)  | 0.3           |
| Fentanyl         | Transdermal        | 2.4 per mcg/hr per day |
| Methadone PO     | 1–20 mg/day        | 4             |
| Methadone PO     | 21–40 mg/day       | 8             |
| Methadone PO     | 41–60 mg/day       | 10            |
| Methadone PO     | >60 mg/day         | 12            |

## Running locally

The app is fully static. Either open `index.html` directly, or serve the folder
over HTTP:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Hosting on GitHub Pages

This repository is structured to serve from `main` at the repository root:

1. Push to `main` (already done if you cloned this).
2. In the repository on GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
4. Pick branch `main`, folder `/ (root)`, and save.
5. GitHub will publish to `https://<user>.github.io/<repo>/` within a minute.

There is no build step. All assets (`index.html`, `app.js`, `styles.css`) sit at
the repo root with relative paths.

## Files

- `index.html` — UI structure
- `styles.css` — styling
- `app.js` — drug catalog, MAR parser, MME engine, ledger, rendering

## Disclaimer

Published equianalgesic ratios are estimates. Methadone conversions in
opioid-tolerant patients should involve a pain or palliative-care specialist.
Account for residual fentanyl release for 12–36 hours after patch removal and
for any long-acting formulations. Use additional caution in elderly patients
and in hepatic, renal, or pulmonary disease. **This tool is not a substitute
for clinical judgement.**
