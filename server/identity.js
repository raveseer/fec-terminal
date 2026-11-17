// Donor identity matching — decides when two differently-written donor records are the same donor.
//
// The stored donor_key is "NORMALIZED NAME|STATE", so "SMITH, JOHN", "SMITH, JOHN MR." and
// "SMITH, JOHN A" are three donors. Two rules merge them, deliberately conservative:
//   strict: same surname + same given names once courtesy titles are dropped + same state
//           ("HASLAM, JAMES A. III" = "HASLAM, JAMES A. MR. III")
//   loose:  same surname + same FIRST name + same suffix + same 5-digit ZIP
//           ("SMITH, JOHN" = "SMITH, JOHN A" when both are in 37660). Needs a ZIP on both records.
// Organizations (anything that isn't LAST, FIRST) match on name with corporate/PAC suffixes removed.
// Father/son pairs (JR vs SR / II vs III) never merge, and nothing merges on name alone.

const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "HON", "REV", "SEN", "REP", "GOV", "JUDGE", "MD", "DDS", "PHD", "ESQ", "CPA", "DO"]);
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const ORG_TAIL = /\s+(INCORPORATED|INC|LLC|L L C|CORPORATION|CORP|COMPANY|CO|LTD|LP|LLP|PLLC|PLC|PC|PA|POLITICAL ACTION COMMITTEE|PAC|FEDERAL PAC|FED PAC)$/;
const clean = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9, ]/g, " ").replace(/\s+/g, " ").trim();

// -> { person, last, first, given, suffix } | { person: false, org }
export function parseDonorName(name) {
  const c = clean(name);
  const comma = c.indexOf(",");
  if (comma <= 0) {
    let org = c.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 3; i++) org = org.replace(ORG_TAIL, "").trim();
    return { person: false, org: org.replace(/^THE /, "") };
  }
  const last = c.slice(0, comma).replace(/,/g, " ").trim();
  const rest = c.slice(comma + 1).replace(/,/g, " ").split(" ").filter(Boolean);
  let suffix = "";
  const given = [];
  for (const t of rest) {
    if (TITLES.has(t)) continue;
    if (SUFFIXES.has(t)) { suffix = t; continue; }
    given.push(t);
  }
  // "SMITH JR, JOHN" — suffix written with the surname
  const lp = last.split(" ");
  let surname = last;
  if (lp.length > 1 && SUFFIXES.has(lp[lp.length - 1])) { suffix = suffix || lp.pop(); surname = lp.join(" "); }
  if (!surname || !given.length) return { person: false, org: c.replace(/,/g, " ").replace(/\s+/g, " ").trim() };
  return { person: true, last: surname, first: given[0], given: given.join(" "), suffix };
}

// Matching keys for one record. Two records are the same donor when they share any key.
export function identityKeys({ name, state = "", zip = "" }) {
  const p = parseDonorName(name);
  const st = String(state || "").toUpperCase().trim();
  const z = /^\d{5}/.test(String(zip || "")) ? String(zip).slice(0, 5) : "";
  if (!p.person) return p.org ? [`O|${p.org}`] : [];
  const keys = [`S|${p.last}|${p.given}|${p.suffix}|${st}`];
  if (z) keys.push(`L|${p.last}|${p.first}|${p.suffix}|${z}`);
  return keys;
}

// Union-find merge of donor groups. `groups` items need { name, state|st, zip }; `combine(into, from)`
// folds one group into another. Returns the merged list; each survivor gets `variants` (count of
// source records) and keeps the fields of its largest member.
export function mergeDonorGroups(groups, { weight = (g) => g.total || 0, combine } = {}) {
  const parent = groups.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  groups.forEach((g, i) => {
    for (const k of identityKeys({ name: g.name, state: g.state ?? g.st, zip: g.zip })) {
      const j = seen.get(k);
      if (j == null) seen.set(k, i);
      else { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    }
  });
  const buckets = new Map();
  groups.forEach((g, i) => { const r = find(i); (buckets.get(r) || buckets.set(r, []).get(r)).push(g); });
  const out = [];
  for (const members of buckets.values()) {
    members.sort((a, b) => weight(b) - weight(a));
    const head = { ...members[0], variants: members.length, names: [...new Set(members.map((m) => m.name))] };
    for (const m of members.slice(1)) combine(head, m);
    out.push(head);
  }
  return out;
}
