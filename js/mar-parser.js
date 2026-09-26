// MAR-paste parser. Identifies drug headers, order lines, and date/time/dose
// triplets in pasted EHR text. Returns { orders, warnings }.
import { DRUGS, DRUG_ALIASES } from './drugs.js';

const ROUTE_PATTERNS = [
  { rx: /\btransdermal\b|\bpatch\b|mcg\s*\/\s*hr/i, route: 'TD' },
  { rx: /\bIV\b|\bintraven/i,                       route: 'IV' },
  { rx: /\bIM\b|\bintramuscul/i,                    route: 'IM' },
  { rx: /\bSC\b|\bSUBQ\b|\bsubcut/i,                route: 'SC' },
  { rx: /\bsublingual\b|\bSL\b/i,                   route: 'SL' },
  { rx: /\bPO\b|\boral\b|\btab\b|\bcap(?:sule)?\b|\bsoln\b|\bsolution\b|\bsuspension\b|\belixir\b|\bliquid\b/i, route: 'PO' },
];
// Returns null when the order line names no route.
function detectRoute(line) { for (const p of ROUTE_PATTERNS) if (p.rx.test(line)) return p.route; return null; }

function matchDrugHeader(line) {
  const clean = line.replace(/^[\s••\-*]+/, '').trim();
  if (!clean || clean.length > 120) return null;
  const firstWord = clean.split(/[\s(,]/)[0].toLowerCase();
  if (DRUGS[firstWord]) return firstWord;
  const parenMatch = clean.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const parenWord = parenMatch[1].split(/[\s,]/)[0].toLowerCase();
    if (DRUGS[parenWord]) return parenWord;
    if (DRUG_ALIASES[parenWord]) return DRUG_ALIASES[parenWord];
  }
  if (DRUG_ALIASES[firstWord]) return DRUG_ALIASES[firstWord];
  const lower = clean.toLowerCase();
  for (const alias in DRUG_ALIASES) {
    if (alias.includes(' ') && lower.startsWith(alias)) return DRUG_ALIASES[alias];
  }
  return null;
}

function matchOrderLine(line) {
  const m = line.match(/^(?:or\s+)?([\d.]+)\s*(mg|mcg|g)\b(?:\s*\/\s*hr)?\s*[,;]/i);
  if (!m) return null;
  const isRate = /mcg\s*\/\s*hr/i.test(line) || /\bpatch\b/i.test(line);
  const route = isRate ? 'TD' : detectRoute(line);
  return { strength: parseFloat(m[1]), unit: m[2].toLowerCase(), route: route || 'PO', routeAssumed: !route, raw: line };
}
function matchDateLine(s) { return /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); }
function matchTimeLine(s) { return /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(s); }
function matchDoseLine(s) { return /^([\d.]+)\s*(mg|mcg|g)$/i.exec(s); }
// Accepts 24-hour ("20:35") and 12-hour ("2:30 pm", "12:05 AM") times.
export function parseTimestamp(d, t) {
  const [mo, da, y] = d.split('/').map(Number);
  const yr = y < 100 ? 2000 + y : y;
  const tm = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(t.trim());
  if (!tm) return NaN;
  let hh = Number(tm[1]);
  const mm = Number(tm[2]);
  const ap = tm[3] ? tm[3].toLowerCase() : null;
  if (ap) {
    if (hh < 1 || hh > 12) return NaN;
    if (ap === 'am' && hh === 12) hh = 0;
    else if (ap === 'pm' && hh !== 12) hh += 12;
  }
  if (hh > 23 || mm > 59) return NaN;
  return new Date(yr, mo - 1, da, hh, mm).getTime();
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export function parseMAR(text) {
  const warnings = [];
  const orders = [];
  if (!text || !text.trim()) return { orders, warnings };
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim());
  let currentDrug = null, currentOrder = null, i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i++; continue; }
    const drug = matchDrugHeader(line);
    if (drug && !/^[\d.]/.test(line)) { currentDrug = drug; currentOrder = null; i++; continue; }
    const order = matchOrderLine(line);
    if (order) {
      if (!currentDrug) { warnings.push('Order line without a recognized drug header: "' + truncate(line, 60) + '"'); i++; continue; }
      currentOrder = { drug: currentDrug, route: order.route, strength: order.strength, strengthUnit: order.unit, rawOrder: line, admins: [], parseWarnings: [] };
      if (order.routeAssumed) {
        const w = `No route found in order line "${truncate(line, 60)}"; assumed PO. Check: an IV/IM/SC order would be several times more potent.`;
        currentOrder.parseWarnings.push(w);
        warnings.push(w);
      }
      orders.push(currentOrder);
      i++; continue;
    }
    if (i + 2 < lines.length) {
      const dm = matchDateLine(lines[i]);
      const tm = dm && matchTimeLine(lines[i + 1]);
      const ddm = tm && matchDoseLine(lines[i + 2]);
      if (dm && tm && ddm) {
        if (!currentOrder) { warnings.push('Dose history without a preceding order; skipping.'); i += 3; continue; }
        const ts = parseTimestamp(lines[i], lines[i + 1]);
        if (!Number.isFinite(ts)) {
          warnings.push(`Unreadable date/time "${lines[i]} ${lines[i + 1]}"; dose skipped.`);
        } else {
          currentOrder.admins.push({ date: lines[i], time: lines[i + 1], dose: parseFloat(ddm[1]), unit: ddm[2].toLowerCase(), ts });
        }
        i += 3; continue;
      }
    }
    i++;
  }
  const used = orders.filter(o => o.admins.length > 0);
  if (orders.length > used.length) warnings.push((orders.length - used.length) + ' order(s) had no recorded administrations and were omitted.');
  return { orders: used, warnings };
}
