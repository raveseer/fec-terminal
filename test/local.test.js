import test from "node:test";
import assert from "node:assert/strict";
import { textHasAmount, textHasName, namesAgree, checkRows, checkTotals, repairTotals, pageType } from "../server/localread.js";

test("amount confirmation is literal and does not accept a near miss", () => {
  const t = "Amount of Contribution: $1,800.0\n 0   Date 4/17/2024   $250.00  $1,800.75";
  assert.ok(textHasAmount(t, 250));
  assert.ok(textHasAmount("Amount $1,800.00", 1800));
  assert.ok(textHasAmount("Amount $1,800.0\n0", 1800), "value wrapped across two lines");
  assert.ok(textHasAmount(t, 1800.75));
  assert.ok(!textHasAmount("total $1,800.75", 1800), "1,800.75 must not confirm 1,800");
  assert.ok(!textHasAmount("paid $11,800.00", 1800));
  assert.ok(!textHasAmount("paid $1,800.00", 180));
  assert.ok(!textHasAmount(t, 0));
});

test("names: literal match in text, tolerant match between two handwriting readings", () => {
  assert.ok(textHasName("First Name: Wade   Last Name: Farmer", "FARMER, WADE"));
  assert.ok(!textHasName("First Name: Wade   Last Name: Farmer", "FARMER, WAYNE"));
  assert.ok(namesAgree("BUCKINGHAM, SCOTT", "Scott Buckingham"));
  assert.ok(namesAgree("BUCKINGHAM, SCOTT", "BUCKINGHAN, SCOTT"), "one letter apart");
  assert.ok(!namesAgree("BUCKINGHAM, SCOTT", "BUCKWHOM, SCOTT"), "a different reading is a disagreement");
});

test("text page: a row the model invented is held for review", () => {
  const text = "ITEMIZED STATEMENT OF CONTRIBUTIONS\nWade Farmer 250 McCarty Church Road $1,800.00 4/17/2024\nTOTAL $1,800.00";
  const rows = [{ kind: "contribution", name: "FARMER, WADE", amount: 1800, date: "2024-04-17" }, { kind: "contribution", name: "SMITH, JOHN", amount: 500, date: "2024-04-18" }];
  const out = checkRows(rows, { scanned: false, text, pageTotal: 1800, periodStart: "2024-04-01", periodEnd: "2024-06-30" });
  assert.equal(out.rows[1].review, "pending");
  assert.ok(out.rows[1].flags.includes("amount_not_in_text") && out.rows[1].flags.includes("name_not_in_text"));
  assert.ok(out.rows.every((r) => r.flags.includes("page_total_mismatch")), "2,300 read vs 1,800 printed");
  const good = checkRows([rows[0]], { scanned: false, text, pageTotal: 1800, periodStart: "2024-04-01", periodEnd: "2024-06-30" });
  assert.equal(good.rows[0].review, "ok");
  assert.equal(good.rows[0].source, "pdf-text");
});

test("scanned page: only two agreeing readers plus a matching total pass", () => {
  const a = [{ kind: "contribution", name: "JONES, MARY", amount: 500, date: "2022-03-01" }, { kind: "contribution", name: "ACME PAVING", amount: 1000, date: "2022-03-02" }];
  const agree = checkRows(a, { scanned: true, text: "", second: [{ name: "Mary Jones", amount: 500 }, { name: "ACME PAVING", amount: 1000 }], pageTotal: 1500 });
  assert.deepEqual(agree.rows.map((r) => r.review), ["ok", "ok"]);
  const noTotal = checkRows(a, { scanned: true, text: "", second: [{ name: "Mary Jones", amount: 500 }, { name: "ACME PAVING", amount: 1000 }], pageTotal: null });
  assert.ok(noTotal.rows.every((r) => r.review === "pending"), "no running total to check → a person looks");
  const differ = checkRows(a, { scanned: true, text: "", second: [{ name: "Mary Jones", amount: 800 }, { name: "ACME PAVING", amount: 1000 }, { name: "EXTRA ROW", amount: 75 }], pageTotal: 1500 });
  assert.equal(differ.rows[0].review, "pending");
  assert.ok(differ.rows[0].flags.includes("amount_not_confirmed"));
  assert.equal(differ.missed.length, 2, "rows only the second reader saw are reported");
  const single = checkRows(a, { scanned: true, text: "", second: null, pageTotal: 1500 });
  assert.ok(single.rows.every((r) => r.review === "pending" && r.flags.includes("amount_single_reader")));
  const carried = checkRows(a, { scanned: true, text: "ACME PAVING 1,000.00 Mary Jones 500.00", second: null, prior: 2000, pageTotal: 3500 });
  assert.deepEqual(carried.rows.map((r) => r.review), ["ok", "ok"], "typed scan confirmed by Tesseract, total carried from the page before");
});

test("summary arithmetic and page classification", () => {
  assert.equal(checkTotals({ balance_last: 16804.87, receipts: 1800, disbursements: 208.29, balance: 18396.58 }).adds, true);
  assert.equal(checkTotals({ balance_last: 200, receipts: 290.5, disbursements: 290.5, balance: 0 }).adds, false);
  assert.equal(checkTotals({}), null);
  assert.equal(pageType("ITEMIZED STATEMENT OF CONTRIBUTIONS - CANDIDATE"), "contributions");
  assert.equal(pageType("ITEMIZED STATEMENT OF EXPENDITURES - CANDIDATE"), "expenditures");
  assert.equal(pageType("CAMPAIGN FINANCIAL DISCLOSURE STATEMENT ... 12. Summary: a. Balance On Hand Last Report"), "summary");
  assert.equal(pageType("SUMMARY PAGE - CANDIDATE 15. Receipts: b. Itemized Contributions"), "summary");
});

test("summary repair only accepts a figure that is printed on the page", () => {
  const text = "a. BALANCE ON HAND LAST REPORT $1,232.30\n b. TOTAL RECEIPTS $6,859.15\n $6,859.15\n c. TOTAL DISBURSEMENTS\n d. BALANCE ON HAND $1,232.30";
  const t = repairTotals(checkTotals({ balance_last: 1232.3, receipts: 6859.15, disbursements: 0, balance: 1232.3 }), text);
  assert.equal(t.disbursements, 6859.15); assert.equal(t.adds, true); assert.equal(t.repaired.field, "disbursements");
  const once = "LAST REPORT $1,232.30 RECEIPTS $6,859.15 BALANCE $1,232.30"; // the figure appears once, and receipts already uses it
  assert.equal(repairTotals(checkTotals({ balance_last: 1232.3, receipts: 6859.15, disbursements: 0, balance: 1232.3 }), once).adds, false);
});
