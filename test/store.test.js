// Run with: npm test   (node's built-in runner; uses a throwaway DATA_DIR, never the real store)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fec-test-"));
const db = await import("../server/db.js");
const { entityFromRow } = await import("../server/tn.js");

test("cache: live hit, expiry, and stale fallback", async () => {
  db.cacheSet("k1", { v: 1 }, 30);
  assert.deepEqual(db.cacheGet("k1"), { v: 1 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(db.cacheGet("k1"), null, "expired rows are not served as hits");
  const stale = db.cacheGetStale("k1");
  assert.deepEqual(stale.value, { v: 1 }, "but remain readable as an explicit stale fallback");
  assert.equal(stale.expired, true);
});

const row = (i, over = {}) => ({ source: "fec", subId: `s${i}`, donorKey: "HASLAM JAMES A III|TN", donorName: "HASLAM, JAMES A. III",
  employer: "PILOT TRAVEL CENTERS", state: "TN", recipientId: "C1", recipientName: "CMTE ONE", cycle: "2026", date: "2026-01-02", amount: 100, ...over });

test("donor search: token match in any order, memo rows excluded, results track new writes", () => {
  db.contribUpsertMany([row(1), row(2, { amount: 250 }), row(3, { memo: true, amount: 9999 }),
    row(4, { donorKey: "SMITH JOHN|TN", donorName: "SMITH, JOHN", employer: "FEDEX CORP", amount: 40 })]);
  const g = db.contribDonorGroups({ q: "james haslam" });
  assert.equal(g.length, 1);
  assert.equal(g[0].total, 350);
  assert.equal(g[0].count, 2);
  // memoized result must not hide a later write
  db.contribUpsertMany([row(5, { amount: 50 })]);
  assert.equal(db.contribDonorGroups({ q: "james haslam" })[0].total, 400);
  // callers get their own copy
  const a = db.contribDonorGroups({ q: "smith" }); a[0].total = -1;
  assert.equal(db.contribDonorGroups({ q: "smith" })[0].total, 40);
});

test("employer rollup and stats agree with the rows", () => {
  const f = db.contribFieldAgg({ q: "fedex", field: "employer" });
  assert.equal(f.totals.count, 1);
  assert.equal(f.totals.total, 40);
  assert.equal(f.variants[0].value, "FEDEX CORP");
  const s = db.contribStats();
  assert.equal(s.rows, 5);
  assert.equal(s.donors, 2);
});

test("superseded-report purge deletes exactly the prefix", () => {
  db.contribUpsertMany([row("x", { source: "tn", subId: "123:c0" }), row("y", { source: "tn", subId: "123:c1" }), row("z", { source: "tn", subId: "1234:c0" })]);
  db.contribDeleteBySubIdPrefix("tn", "123:");
  const left = db.contribDonorRows("HASLAM JAMES A III|TN").filter((r) => r.source === "tn").map((r) => r.subId);
  assert.deepEqual(left, ["1234:c0"]);
});

test("TREF result row -> directory entity -> local search", () => {
  const headers = ["Salutation", "First Name", "Last Name", "Address 1", "Address 2", "City", "State", "Zip", "Phone", "Email",
    "Treasurer Name", "Treasurer City", "Party Affliation", "Office Sought", "District", "Primary", "General", "Election Year", "Created", "Closed"];
  const cand = entityFromRow(headers, ["Rep.", "REBECCA KEEFAUVER", "ALEXANDER", "P.O. BOX 901", "", "JONESBOROUGH", "TN", "37659", "", "",
    "WADE FARMER", "JOHNSON CITY", "Republican", "House of Representatives", "07", "08/06/2026 (W)", "", "2026", "", ""], "8022");
  assert.equal(cand.name, "ALEXANDER, REBECCA KEEFAUVER");
  assert.equal(cand.kind, "candidate");
  const pac = entityFromRow(headers, ["", "", "INNOVATIVE HEALTH CARE PAC", "730 COOL SPRINGS BLVD.", "", "FRANKLIN", "TN", "37067", "", "",
    "MATTHEW NESS", "", "None", "", "", "", "", "", "", ""], "3483");
  assert.equal(pac.kind, "pac");
  assert.equal(entityFromRow(headers, ["", "", "NO ID PAC"], null), null);
  db.tnEntityUpsertMany([cand, pac]);
  assert.equal(db.tnEntitySearch({ q: "health" }).total, 1, "substring match on name");
  assert.equal(db.tnEntitySearch({ q: "farmer" }).rows[0].tnId, "8022", "treasurer is searchable");
  assert.equal(db.tnEntitySearch({ zip: "376", winner: "primary" }).total, 1);
  assert.equal(db.tnEntitySearch({ district: "7", office: "House of Representatives" }).total, 1, "district matches with or without zero padding");
  // a thinner re-upsert must not blank stored fields
  db.tnEntityUpsertMany([{ tnId: "8022", year: "2026", name: "ALEXANDER, REBECCA KEEFAUVER" }]);
  assert.equal(db.tnEntitySearch({ q: "alexander" }).rows[0].treasurer, "WADE FARMER");
});

const { parseDonorName, identityKeys, mergeDonorGroups } = await import("../server/identity.js");

test("donor identity: titles ignored, suffixes and middle names respected", () => {
  assert.deepEqual(parseDonorName("HASLAM, JAMES A. MR. III"), { person: true, last: "HASLAM", first: "JAMES", given: "JAMES A", suffix: "III" });
  assert.equal(parseDonorName("TRACTOR SUPPLY COMPANY POLITICAL ACTION COMMITTEE").org, "TRACTOR SUPPLY");
  const share = (a, b) => identityKeys(a).some((k) => identityKeys(b).includes(k));
  assert.ok(share({ name: "HASLAM, JAMES A. III", state: "TN" }, { name: "HASLAM, JAMES A. MR. III", state: "TN" }), "courtesy title only");
  assert.ok(!share({ name: "SMITH, JOHN", state: "TN" }, { name: "SMITH, JOHN A", state: "TN" }), "middle initial differs and no ZIP → not merged");
  assert.ok(share({ name: "SMITH, JOHN", state: "TN", zip: "37660" }, { name: "SMITH, JOHN A", state: "TN", zip: "376601234" }), "same first name + same ZIP");
  assert.ok(!share({ name: "SMITH, JOHN JR", state: "TN", zip: "37660" }, { name: "SMITH, JOHN SR", state: "TN", zip: "37660" }), "father and son stay separate");
  assert.ok(!share({ name: "SMITH, JOHN", state: "TN", zip: "37660" }, { name: "SMITH, JOHN", state: "GA", zip: "30301" }), "same name, different place");
});

test("donor identity: groups merge transitively and keep the largest record's fields", () => {
  const out = mergeDonorGroups([
    { name: "SMITH, JOHN MR.", st: "TN", zip: "37660", total: 100, n: 1 },
    { name: "SMITH, JOHN", st: "TN", zip: "", total: 500, n: 2 },
    { name: "SMITH, JOHN A", st: "TN", zip: "37660", total: 50, n: 1 },
    { name: "JONES, MARY", st: "TN", zip: "37660", total: 10, n: 1 },
  ], { weight: (g) => g.total, combine: (a, b) => { a.total += b.total; a.n += b.n; } });
  assert.equal(out.length, 2);
  const smith = out.find((g) => g.name.startsWith("SMITH"));
  assert.equal(smith.total, 650);
  assert.equal(smith.variants, 3);
  assert.equal(smith.name, "SMITH, JOHN", "largest member is the display record");
});
