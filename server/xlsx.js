// Minimal .xlsx reader: enough to pull rows out of the first worksheet of a state-published
// spreadsheet without adding a dependency. Handles shared strings, inline strings and numbers.
import zlib from "node:zlib";

function entries(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error("Not a zip archive.");
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  const out = new Map();
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    out.set(buf.toString("utf8", p + 46, p + 46 + nameLen), { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function read(buf, e) {
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const raw = buf.subarray(start, start + e.csize);
  return (e.method === 0 ? raw : zlib.inflateRawSync(raw)).toString("utf8");
}
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const colIndex = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// → array of rows; each row is a sparse array of strings indexed by column (A = 0)
export function xlsxRows(buf, { maxRows = 500_000 } = {}) {
  const z = entries(buf);
  const shared = z.has("xl/sharedStrings.xml")
    ? [...read(buf, z.get("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")))
    : [];
  const name = [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!name) throw new Error("The workbook has no worksheet.");
  const xml = read(buf, z.get(name));
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g, cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = rowRe.exec(xml)) && rows.length < maxRows) {
    const row = [];
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(m[1]))) {
      const type = (c[2].match(/t="(\w+)"/) || [])[1], body = c[3] || "";
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      row[colIndex(c[1])] = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? unesc((body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "") : v != null ? unesc(v) : "";
    }
    rows.push(row);
  }
  return rows;
}
export const excelDate = (serial) => { const n = Number(serial); return Number.isFinite(n) && n > 20000 ? new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10) : null; };

// RFC-4180-ish CSV → array of string arrays
export function csvRows(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
