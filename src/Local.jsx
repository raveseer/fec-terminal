// Tennessee → Local: county and city campaign filings from the county election commissions that
// publish online, plus the reader that turns scanned paper reports into rows and the queue where a
// person confirms what the reader was not sure of.
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtUSD, fmtNum, timeAgo, downloadCSV, getJSON } from "./lib.js";

const post = (url, body) => getJSON(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
const inputStyle = { background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "7px 10px", fontSize: 13, borderRadius: "var(--radius-sm)", minWidth: 0 };
const FLAG_TEXT = {
  amount_not_in_text: "amount not found in the page text", name_not_in_text: "name not found in the page text",
  amount_single_reader: "amount read by one reader only", name_single_reader: "name read by one reader only",
  amount_not_confirmed: "second reader did not confirm the amount", name_not_confirmed: "second reader did not confirm the name",
  page_total_mismatch: "rows do not add up to the page total", no_page_total_to_check: "no page total to check against",
  no_date: "no date", date_outside_period: "date is outside the reporting period", not_in_portal_data: "not in the county's structured data",
  document_total_mismatch: "report's itemized total does not match", entered_by_hand: "entered by hand",
};
const flagText = (f) => (f.startsWith("readers_disagree_on_name:") ? `second reader read the name as “${f.split(":").slice(1).join(":")}”` : FLAG_TEXT[f] || f.replace(/_/g, " "));
const SRC = { portal: ["filed online", "var(--olive)"], "pdf-text": ["from PDF text", "var(--muted)"], ocr: ["OCR", "var(--warn)"], manual: ["entered by hand", "var(--brass)"] };
const SrcPill = ({ s }) => <span className="tx-pill" style={{ borderColor: SRC[s]?.[1], color: SRC[s]?.[1] }}>{SRC[s]?.[0] || s}</span>;

// =============================================================================================
//  One document: rows beside the page they were read from
// =============================================================================================
function DocReview({ docId, onClose, onChanged }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null); const [busy, setBusy] = useState(false); const [adding, setAdding] = useState(null); const [fig, setFig] = useState(null);
  const load = useCallback(() => getJSON(`/api/tn/local/doc/${docId}`).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), [docId]);
  useEffect(() => { setD(null); setPage(1); setEdit(null); load(); }, [docId, load]);
  useEffect(() => { // while the reader is on this document, keep looking
    if (d?.doc.status !== "reading") return undefined;
    const t = setInterval(load, 5000); return () => clearInterval(t);
  }, [d?.doc.status, load]);
  const act = async (fn) => { setBusy(true); try { await fn(); await load(); onChanged?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const item = (id, body) => act(() => post(`/api/tn/local/item/${id}`, body));
  if (err && !d) return <div className="tx-panel"><div className="fec-error">{err}</div><button className="fec-btn ghost sm" onClick={onClose}>Close</button></div>;
  if (!d) return <div className="tx-panel"><span className="fec-spin">Loading the document</span></div>;
  const { doc, items } = d;
  const pending = items.filter((i) => i.review === "pending");
  const pages = doc.pages || 1;
  const t = doc.totals;
  return (
    <div className="tx-panel" style={{ borderTop: "3px solid var(--brass)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{doc.filer || "Unlisted filer"} <span className="sub" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>· {doc.name || doc.type} · filed {doc.submitted || "—"} · {doc.county} County</span></h3>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <a className="fec-extlink" href={`/api/tn/local/doc/${doc.id}/pdf`} target="_blank" rel="noopener noreferrer">Open the PDF ↗</a>
          {doc.status !== "reading" && <button className="fec-btn ghost sm" disabled={busy} onClick={() => act(() => post(`/api/tn/local/doc/${doc.id}/read`))}>{doc.status === "done" ? "Read again" : "Read this report"}</button>}
          <button className="fec-btn ghost sm" onClick={onClose}>Close</button>
        </span>
      </div>
      {err && <div className="fec-error" role="alert">{err}</div>}
      <div className="sub" style={{ marginTop: 6 }}>
        {doc.status === "reading" ? <span className="fec-spin">The reader is working on this report</span>
          : doc.status === "done" ? <>Read {timeAgo(doc.extractedAt)} from {doc.method === "text" ? "the PDF’s text" : doc.method === "ocr" ? "a scan (OCR)" : "text and scanned pages"} · {pages} page{pages === 1 ? "" : "s"}{doc.periodStart ? ` · covers ${doc.periodStart} to ${doc.periodEnd}` : ""}</>
          : doc.status === "failed" ? <span style={{ color: "var(--warn)" }}>Reading failed: {doc.error}</span>
          : doc.efiled ? "Filed online — the rows below come from the county’s own data. Reading the PDF adds addresses, employers and totals."
          : "Not read yet. This report exists only as a PDF."}
      </div>
      {t && (
        <div className="tx-kpis">
          <div className="tx-kpi"><span>Balance last report</span><b>{fmtUSD(t.balanceLast)}</b></div>
          <div className="tx-kpi"><span>Receipts</span><b>{fmtUSD(t.receipts)}</b></div>
          <div className="tx-kpi"><span>Disbursements</span><b>{fmtUSD(t.disbursements)}</b></div>
          <div className="tx-kpi"><span>Balance on hand</span><b>{fmtUSD(t.balance)}</b>
            <small style={{ color: t.verified ? "var(--olive)" : "var(--warn)" }}>{t.verified ? (t.repaired ? `figures add up; ${t.repaired.field} taken from the page arithmetic` : "figures add up and were confirmed") : t.adds === false ? "figures do not add up — check the page" : "not confirmed — check the page"}</small></div>
        </div>
      )}
      {t && !t.verified && !fig && (
        <div className="tx-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Compare these four figures with page {t.page || 1}.</span>
          <button className="fec-btn sm" disabled={busy} onClick={() => act(() => post(`/api/tn/local/doc/${doc.id}/totals`, { figures: { balanceLast: t.balanceLast, receipts: t.receipts, disbursements: t.disbursements, balance: t.balance } }))}>They match the page</button>
          <button className="fec-btn ghost sm" onClick={() => { setPage(t.page || 1); setFig({ balanceLast: t.balanceLast ?? "", receipts: t.receipts ?? "", disbursements: t.disbursements ?? "", balance: t.balance ?? "" }); }}>Correct them</button>
        </div>
      )}
      {t?.confirmedBy === "person" && <div className="tx-note">Figures confirmed by you{t.machine ? ` (machine read: receipts ${fmtUSD(t.machine.receipts)}, disbursements ${fmtUSD(t.machine.disbursements)}, balance ${fmtUSD(t.machine.balance)})` : ""}.</div>}
      {fig && (
        <form style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); act(async () => { await post(`/api/tn/local/doc/${doc.id}/totals`, { figures: fig }); setFig(null); }); }}>
          {[["balanceLast", "Balance last report"], ["receipts", "Receipts"], ["disbursements", "Disbursements"], ["balance", "Balance on hand"]].map(([k, label]) => (
            <label key={k} style={{ fontSize: 11, color: "var(--muted)" }}>{label}<input style={{ ...inputStyle, width: 130, display: "block" }} inputMode="decimal" value={fig[k]} onChange={(e) => setFig({ ...fig, [k]: e.target.value })} /></label>
          ))}
          <button className="fec-btn sm" disabled={busy}>Save figures</button><button type="button" className="fec-btn ghost sm" onClick={() => setFig(null)}>Cancel</button>
        </form>
      )}
      {doc.flags.length > 0 && (
        <div className="tx-note warn">
          <ul style={{ paddingLeft: 18, margin: 0 }}>{doc.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
          <button className="fec-btn ghost sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => act(() => post(`/api/tn/local/doc/${doc.id}/totals`, { dismissFlags: true }))} title="After you have checked the report against these warnings">I have checked these — clear the warnings</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(280px, 1fr)", gap: 16, marginTop: 14, alignItems: "start" }} className="lc-split">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <b style={{ fontSize: 13 }}>{fmtNum(items.length)} rows{pending.length ? ` · ${pending.length} to check` : ""}</b>
            <span style={{ display: "flex", gap: 6 }}>
              {pending.length > 0 && <button className="fec-btn ghost sm" disabled={busy} onClick={() => act(() => post(`/api/tn/local/doc/${doc.id}/review`, { action: "approve" }))} title="Only after comparing every flagged row with the page">Approve all {pending.length}</button>}
              <button className="fec-btn ghost sm" onClick={() => setAdding({ kind: "contribution", name: "", amount: "", date: "", page })}>Add a missed row</button>
            </span>
          </div>
          {adding && (
            <form style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }} onSubmit={(e) => { e.preventDefault(); act(async () => { await post(`/api/tn/local/doc/${doc.id}/add`, adding); setAdding(null); }); }}>
              <select style={inputStyle} value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} aria-label="Row type"><option value="contribution">Contribution</option><option value="inkind">In-kind</option><option value="loan">Loan</option><option value="expenditure">Expenditure</option></select>
              <input style={{ ...inputStyle, flex: 2 }} placeholder="LAST, FIRST or organization" aria-label="Name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} required />
              <input style={{ ...inputStyle, width: 130 }} type="date" aria-label="Date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} />
              <input style={{ ...inputStyle, width: 100 }} inputMode="decimal" placeholder="Amount" aria-label="Amount" value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} required />
              <button className="fec-btn sm" disabled={busy}>Add row</button><button type="button" className="fec-btn ghost sm" onClick={() => setAdding(null)}>Cancel</button>
            </form>
          )}
          <div className="fec-table-wrap" style={{ maxHeight: 620, overflowY: "auto" }}>
            <table className="fec-table">
              <thead><tr><th>Name</th><th>Date</th><th style={{ textAlign: "right" }}>Amount</th><th>Standing</th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={4} className="sub">No itemized rows{doc.status === "done" ? " were found in this report" : " yet"}.</td></tr>}
                {items.map((it) => (edit?.id === it.id ? (
                  <tr key={it.id}><td colSpan={4}>
                    <form style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }} onSubmit={(e) => { e.preventDefault(); act(async () => { await post(`/api/tn/local/item/${it.id}`, { action: "edit", fields: edit.f }); setEdit(null); }); }}>
                      {[["name", "Name"], ["date", "Date (YYYY-MM-DD)"], ["amount", "Amount"], ["address", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["employer", "Employer"], ["occupation", "Occupation"], ["purpose", "Purpose"]].map(([k, label]) => (
                        <label key={k} style={{ fontSize: 11, color: "var(--muted)", gridColumn: k === "name" ? "span 2" : undefined }}>{label}
                          <input style={{ ...inputStyle, width: "100%", display: "block" }} value={edit.f[k] ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, [k]: e.target.value } })} />
                        </label>
                      ))}
                      <span style={{ display: "flex", gap: 6, alignItems: "end" }}><button className="fec-btn sm" disabled={busy}>Save correction</button><button type="button" className="fec-btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></span>
                    </form>
                  </td></tr>
                ) : (
                  <tr key={it.id} style={it.review === "rejected" ? { opacity: 0.45 } : undefined} onMouseEnter={() => it.page && setPage(it.page)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{it.name} {it.kind !== "contribution" && <span className="tx-pill">{it.kind === "inkind" ? "in-kind" : it.kind}</span>}</div>
                      <div className="sub">{[[it.address, it.city, it.state, it.zip].filter(Boolean).join(", "), [it.occupation, it.employer].filter(Boolean).join(" · "), it.purpose].filter(Boolean).join(" — ")}</div>
                      {it.flags.length > 0 && it.review === "pending" && <div style={{ fontSize: 12, color: "var(--warn)" }}>{it.flags.map(flagText).join("; ")}</div>}
                      {it.original && <div className="sub">machine read: {it.original.name} · {it.original.date || "no date"} · {fmtUSD(it.original.amount)}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{it.date || "—"}{it.page ? <div className="sub">p. {it.page}</div> : null}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(it.amount)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <SrcPill s={it.source} />
                      {it.source !== "portal" && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                          {it.review === "pending" && <button className="fec-btn sm" disabled={busy} onClick={() => item(it.id, { action: "approve" })}>Correct</button>}
                          {it.review !== "rejected" && <button className="fec-btn ghost sm" disabled={busy} onClick={() => setEdit({ id: it.id, f: Object.fromEntries(["name", "date", "amount", "address", "city", "state", "zip", "employer", "occupation", "purpose"].map((k) => [k, it[k] ?? ""])) })}>Fix</button>}
                          {it.review !== "rejected" ? <button className="fec-btn ghost sm" disabled={busy} onClick={() => item(it.id, { action: "reject" })}>Not a row</button>
                            : <button className="fec-btn ghost sm" disabled={busy} onClick={() => item(it.id, { action: "reopen" })}>Restore</button>}
                          {it.review !== "pending" && it.review !== "rejected" && <span className="sub" style={{ alignSelf: "center" }}>{it.review === "ok" ? "passed every check" : it.review === "edited" ? "corrected by you" : "confirmed by you"}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ minWidth: 0, position: "sticky", top: 70 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <button className="fec-btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
            <span className="sub">Page {page} of {pages}</span>
            <button className="fec-btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
            <span className="sub">Point at a row to see its page.</span>
          </div>
          <a href={`/api/tn/local/doc/${doc.id}/pdf#page=${page}`} target="_blank" rel="noopener noreferrer">
            <img key={page} src={`/api/tn/local/doc/${doc.id}/page/${page}`} alt={`Page ${page} of the filed report`} style={{ width: "100%", border: "1px solid var(--line)", background: "#fff", display: "block" }} />
          </a>
        </div>
      </div>
    </div>
  );
}

// =============================================================================================
//  One filer
// =============================================================================================
function FilerPage({ id, onClose, onOpenDoc, refreshKey }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [msg, setMsg] = useState(null);
  const load = useCallback(() => getJSON(`/api/tn/local/filer/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setD(null); setErr(null); setMsg(null); load(); }, [id, load, refreshKey]);
  if (err) return <div className="tx-panel"><div className="fec-error">{err}</div></div>;
  if (!d) return <div className="tx-panel"><span className="fec-spin">Loading</span></div>;
  const { filer, totals, coverage, docs, donors, payees } = d;
  const readAll = async () => { try { const r = await post("/api/tn/local/reader/start", { filerId: filer.id, limit: 200 }); setMsg(r.running ? "The reader is busy with another job." : "Reading this filer’s reports — rows appear as each one finishes."); } catch (e) { setMsg(e.message); } };
  return (
    <>
      <div className="tx-panel" style={{ borderTop: "3px solid var(--brass)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{filer.name} <span className="sub" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>· {filer.office || "office not listed"} · {filer.county} County · {filer.status || ""}</span></h3>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {filer.url && <a className="fec-extlink" href={filer.url} target="_blank" rel="noopener noreferrer">County portal ↗</a>}
            <button className="fec-btn ghost sm" onClick={onClose}>Close</button>
          </span>
        </div>
        <div className="tx-kpis">
          <div className="tx-kpi"><span>Itemized contributions</span><b>{fmtUSD(totals.raised)}</b><small>{fmtNum(donors.length)} donors</small></div>
          <div className="tx-kpi"><span>Itemized spending</span><b>{fmtUSD(totals.spent)}</b><small>{fmtNum(payees.length)} payees</small></div>
          <div className="tx-kpi"><span>Loans</span><b>{fmtUSD(totals.loans)}</b></div>
          <div className="tx-kpi"><span>Waiting for review</span><b>{fmtNum(totals.pending)}</b><small>{totals.pending ? `${fmtUSD(totals.pendingAmt)} not counted yet` : "nothing held back"}</small></div>
        </div>
        <div className="tx-note" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>{coverage.reports} financial report{coverage.reports === 1 ? "" : "s"}: {coverage.structured} filed online, {coverage.read} read from the PDF, <b style={{ color: coverage.unread ? "var(--warn)" : undefined }}>{coverage.unread} PDF-only report{coverage.unread === 1 ? "" : "s"} not read yet</b>.</span>
          {coverage.unread + coverage.structured - coverage.read > 0 && <button className="fec-btn ghost sm" onClick={readAll}>Read this filer’s reports</button>}
          {msg && <span>{msg}</span>}
        </div>
        <div className="tx-note">Totals count only itemized rows that came from the county’s data, passed every check, or were confirmed by you. Unitemized small gifts are in each report’s receipts figure, not here.</div>
      </div>
      <div className="tx-cols">
        <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px 0" }}>
            <h3 className="tx-h" style={{ margin: 0 }}>Donors</h3>
            {donors.length > 0 && <button className="tx-linkbtn" onClick={() => downloadCSV(`${filer.name}-local-donors.csv`, ["Donor", "Total", "Gifts", "First", "Last", "City", "State", "ZIP", "Employer", "Occupation", "Machine-read rows"], donors.map((x) => [x.name, x.total, x.n, x.first, x.last, x.city, x.state, x.zip, x.employer, x.occupation, x.machine]))}>CSV</button>}
          </div>
          <div className="fec-table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
            <table className="fec-table"><tbody>
              {donors.length === 0 && <tr><td className="sub">No itemized contributions on file yet.</td></tr>}
              {donors.map((x) => <tr key={x.norm}><td><div>{x.name} {x.machine > 0 && <span className="tx-pill" title="At least one of these rows was read from a PDF by machine">machine-read</span>}</div><div className="sub">{[[x.city, x.state].filter(Boolean).join(", "), x.employer].filter(Boolean).join(" · ")}</div></td>
                <td className="sub" style={{ whiteSpace: "nowrap" }}>{x.n} gift{x.n === 1 ? "" : "s"}<br />{x.last}</td><td style={{ textAlign: "right", fontFamily: "var(--font-num)", color: "var(--brass)" }}>{fmtUSD(x.total)}</td></tr>)}
            </tbody></table>
          </div>
        </div>
        <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
          <h3 className="tx-h" style={{ padding: "12px 16px 0" }}>Where the money went</h3>
          <div className="fec-table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
            <table className="fec-table"><tbody>
              {payees.length === 0 && <tr><td className="sub">No itemized spending on file yet.</td></tr>}
              {payees.map((x, i) => <tr key={i}><td>{x.name}{x.purpose && <div className="sub">{x.purpose}</div>}</td><td className="sub">{x.n}×</td><td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{fmtUSD(x.total)}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      </div>
      <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <h3 className="tx-h" style={{ padding: "12px 16px 0" }}>Filings</h3>
        <div className="fec-table-wrap">
          <table className="fec-table">
            <thead><tr><th>Filed</th><th>Document</th><th>Data</th><th style={{ textAlign: "right" }}>Receipts</th><th style={{ textAlign: "right" }}>Spent</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
            <tbody>{docs.map((x) => (
              <tr key={x.id}>
                <td style={{ whiteSpace: "nowrap" }}>{x.submitted || "—"}</td>
                <td><button className="tx-linkbtn" onClick={() => onOpenDoc(x.id)}>{x.name || x.type}</button><div className="sub">{x.type}</div></td>
                <td>{x.kind !== "cfd" && x.kind !== "interim" ? <span className="sub">not a financial report</span>
                  : <>{x.efiled ? <SrcPill s="portal" /> : x.status === "done" ? <SrcPill s={x.method === "text" ? "pdf-text" : "ocr"} /> : x.status === "reading" ? <span className="fec-spin">reading</span> : x.status === "failed" ? <span style={{ color: "var(--warn)" }} title={x.error}>read failed</span> : <span className="tx-pill" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>PDF only, not read</span>}
                    <span className="sub"> {x.items ? `${x.items} rows` : ""}{x.pending ? ` · ${x.pending} to check` : ""}</span></>}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{x.totals ? fmtUSD(x.totals.receipts) : ""}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{x.totals ? fmtUSD(x.totals.disbursements) : ""}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{x.totals ? <span title={x.totals.verified ? "figures add up and were confirmed" : "not confirmed — open the report"} style={x.totals.verified ? undefined : { color: "var(--warn)" }}>{fmtUSD(x.totals.balance)}{x.totals.verified ? "" : " ?"}</span> : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// =============================================================================================
//  Section
// =============================================================================================
export default function Local({ seed }) {
  const [view, setView] = useState("filers");
  const [src, setSrc] = useState(null); const [err, setErr] = useState(null);
  const [sub, setSub] = useState(""); const [q, setQ] = useState(""); const [office, setOffice] = useState(""); const [active, setActive] = useState(false);
  const [list, setList] = useState(null); const [filerId, setFilerId] = useState(null); const [docId, setDocId] = useState(null);
  const [sq, setSq] = useState(""); const [skind, setSkind] = useState("in"); const [found, setFound] = useState(null);
  const [queue, setQueue] = useState(null); const [tick, setTick] = useState(0); const [limit, setLimit] = useState(25);
  const first = useRef(true);
  const [up, setUp] = useState({ county: "", filer: "", office: "", name: "", filed: "" }); const [upMsg, setUpMsg] = useState(null); const fileRef = useRef(null);
  useEffect(() => { if (seed?.filerId) { setSub(""); setOffice(""); setQ(""); setDocId(null); setView("filers"); setFilerId(seed.filerId); } }, [seed?.filerId, seed?.t]);
  const upload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setUpMsg("Choose a PDF first."); return; }
    setUpMsg("Uploading…");
    try {
      const res = await fetch(`/api/tn/local/upload?${new URLSearchParams(up)}`, { method: "POST", headers: { "content-type": "application/pdf" }, body: file });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message || "Upload failed.");
      setUpMsg(d.duplicate ? "That file was already uploaded." : d.reading ? "Uploaded. The reader has started on it." : "Uploaded. The reader is busy; open the report and press “Read this report” when it is free.");
      fileRef.current.value = ""; await loadSrc(); setTick((n) => n + 1); setDocId(d.docId);
    } catch (x) { setUpMsg(x.message); }
  };
  const loadSrc = useCallback(() => getJSON("/api/tn/local/sources").then((x) => { setSrc(x); return x; }).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    loadSrc().then((x) => {
      if (!x || !first.current) return; first.current = false;
      if (x.home?.[0]) setSub(x.home[0]);
      if (!x.sync.at && !x.sync.running) post("/api/tn/local/sync").then(loadSrc).catch(() => {}); // first visit: fetch every county once
    });
  }, [loadSrc]);
  const busy = src?.sync.running || src?.reader.running;
  useEffect(() => { if (!busy) return undefined; const t = setInterval(() => { loadSrc(); setTick((n) => n + 1); }, 4000); return () => clearInterval(t); }, [busy, loadSrc]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { getJSON(`/api/tn/local/filers?${new URLSearchParams({ sub, q, office, ...(active ? { active: "1" } : {}) })}`).then((x) => live && setList(x)).catch((e) => live && setErr(e.message)); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [sub, q, office, active, src?.sync.at, src?.sync.running]);
  useEffect(() => { if (view !== "review") return; getJSON(`/api/tn/local/review?${new URLSearchParams(sub ? { sub } : {})}`).then(setQueue).catch((e) => setErr(e.message)); }, [view, sub, tick]);
  useEffect(() => {
    if (sq.trim().length < 2) { setFound(null); return undefined; }
    let live = true;
    const t = setTimeout(() => getJSON(`/api/tn/local/search?${new URLSearchParams({ q: sq, kind: skind === "out" ? "out" : "", ...(sub ? { sub } : {}) })}`).then((x) => live && setFound(x)).catch((e) => live && setErr(e.message)), 250);
    return () => { live = false; clearTimeout(t); };
  }, [sq, skind, sub]);
  const openDoc = (id) => { setDocId(id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const pendingAll = src ? src.sources.reduce((a, s) => a + (s.reviewDocs || 0), 0) : 0;
  const county = src?.sources.find((s) => s.sub === sub);
  const startReader = async (body) => { try { await post("/api/tn/local/reader/start", body); await loadSrc(); } catch (e) { setErr(e.message); } };
  const r = src?.reader;

  return (
    <>
      <p className="tx-lede">
        County and city offices — mayors, commissioners, sheriffs, school boards, judges. Local candidates file with their county election commission, and <b>{src ? src.sources.filter((s) => !s.uploads).length : "fourteen"} Tennessee counties publish those filings online</b>.
        Reports filed electronically arrive as data; paper reports are scanned PDFs that are read here by machine, with anything uncertain <b>held for you to check</b>.
      </p>
      <div className="tx-panel">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select style={inputStyle} value={sub} onChange={(e) => { setSub(e.target.value); setOffice(""); setFilerId(null); }} aria-label="County">
            <option value="">All counties</option>
            {src?.sources.filter((s) => !s.uploads || s.filers > 0).map((s) => <option key={s.sub} value={s.sub}>{s.uploads ? "Uploaded by you" : `${s.county} County`}{s.filers ? ` — ${fmtNum(s.filers)} filers` : ""}</option>)}
          </select>
          <div className="tx-subnav" role="tablist" aria-label="Local views" style={{ display: "inline-flex", margin: 0 }}>
            {[["filers", "Candidates and committees"], ["search", "Find a donor or payee"], ["review", `Review${pendingAll ? ` (${fmtNum(pendingAll)})` : ""}`], ["sources", "Counties and reader"]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => { setView(id); setDocId(null); }}>{label}</button>
            ))}
          </div>
          {src?.sync.running && <span className="fec-spin">Fetching {src.sync.current || "counties"} ({src.sync.done}/{src.sync.total})</span>}
          {r?.running && <span className="fec-spin">Reading reports ({r.done}/{r.total})</span>}
        </div>
        {county && view !== "sources" && <div className="tx-note">{county.county} County: {fmtNum(county.docs)} documents, {fmtNum(county.contribs)} itemized contributions and {fmtNum(county.dists)} expenditures filed online; {fmtNum(Math.max(0, county.paper - county.read))} PDF-only reports not read yet{county.syncedAt ? ` · fetched ${timeAgo(county.syncedAt)}` : ""}.</div>}
      </div>
      {err && <div className="fec-error" role="alert">{err} <button className="tx-linkbtn" onClick={() => setErr(null)}>dismiss</button></div>}
      {docId && <DocReview docId={docId} onClose={() => setDocId(null)} onChanged={() => { setTick((n) => n + 1); loadSrc(); }} />}

      {view === "filers" && !docId && (
        <>
          {filerId && <FilerPage id={filerId} onClose={() => setFilerId(null)} onOpenDoc={openDoc} refreshKey={tick} />}
          <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, padding: "12px 16px", flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inputStyle, flex: 1, minWidth: 220, maxWidth: 420 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or office — e.g. sheriff, Jonesborough" aria-label="Search local filers" />
              {list?.offices?.length > 0 && <select style={{ ...inputStyle, maxWidth: 260 }} value={office} onChange={(e) => setOffice(e.target.value)} aria-label="Office"><option value="">Every office</option>{list.offices.map((o) => <option key={o.office} value={o.office}>{o.office} ({o.n})</option>)}</select>}
              <label style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active accounts only</label>
              {list && <span className="sub">{fmtNum(list.total)} filer{list.total === 1 ? "" : "s"}{list.total > list.filers.length ? ` · showing ${list.filers.length}` : ""}</span>}
            </div>
            <div className="fec-table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
              <table className="fec-table">
                <thead><tr><th>Candidate or committee</th><th>Office</th><th>Latest filing</th><th style={{ textAlign: "right" }}>Itemized raised</th><th style={{ textAlign: "right" }}>Itemized spent</th></tr></thead>
                <tbody>
                  {!list && <tr><td colSpan={5}><span className="fec-spin">Loading</span></td></tr>}
                  {list?.filers.length === 0 && <tr><td colSpan={5} className="sub">{src?.sync.running ? "Still fetching the counties." : "No filers match."}</td></tr>}
                  {list?.filers.map((f) => (
                    <tr key={f.id}>
                      <td><button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 500 }} onClick={() => { setFilerId(f.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{f.name}</button>
                        <div className="sub">{!sub && `${f.county} County · `}{f.status}{f.pending ? <span style={{ color: "var(--warn)" }}> · {f.pending} row{f.pending === 1 ? "" : "s"} to check</span> : ""}</div></td>
                      <td>{f.office}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{f.latest || "—"}<div className="sub">{f.docs} document{f.docs === 1 ? "" : "s"}</div></td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-num)", color: "var(--brass)" }}>{f.raised ? fmtUSD(f.raised) : ""}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{f.spent ? fmtUSD(f.spent) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {view === "search" && !docId && (
        <div className="tx-panel">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 240, maxWidth: 460 }} value={sq} onChange={(e) => setSq(e.target.value)} placeholder={skind === "out" ? "Who was paid — a vendor or person" : "Who gave — a person, business or PAC"} aria-label="Search local contributions and spending" />
            <div className="tx-seg" role="group" aria-label="Direction">
              <button aria-pressed={skind === "in"} onClick={() => setSkind("in")}>Money in</button>
              <button aria-pressed={skind === "out"} onClick={() => setSkind("out")}>Money out</button>
            </div>
            {found && <span className="sub">{fmtNum(found.total)} rows · {fmtUSD(found.amount)}{found.total > found.rows.length ? ` · largest ${found.rows.length} shown` : ""}</span>}
            {found?.rows.length > 0 && <button className="tx-linkbtn" onClick={() => downloadCSV(`local-${skind}-${sq}.csv`, ["Name", "Type", "Date", "Amount", "To / from", "Office", "County", "City", "State", "Employer", "Source"], found.rows.map((x) => [x.name, x.kind, x.date, x.amount, x.recipient, x.office, x.county, x.city, x.state, x.employer, x.source]))}>CSV</button>}
          </div>
          <div className="tx-note">Searches itemized rows across {sub ? "the selected county" : "every county"}. Paper reports only show up here once they have been read; rows waiting for review are left out.</div>
          {found && (
            <div className="fec-table-wrap" style={{ marginTop: 10, maxHeight: 640, overflowY: "auto" }}>
              <table className="fec-table">
                <thead><tr><th>{skind === "out" ? "Paid to" : "From"}</th><th>{skind === "out" ? "Paid by" : "To"}</th><th>Date</th><th style={{ textAlign: "right" }}>Amount</th><th>Source</th></tr></thead>
                <tbody>
                  {found.rows.length === 0 && <tr><td colSpan={5} className="sub">Nothing matches.</td></tr>}
                  {found.rows.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}{x.kind !== "contribution" && x.kind !== "expenditure" && <span className="tx-pill" style={{ marginLeft: 6 }}>{x.kind === "inkind" ? "in-kind" : x.kind}</span>}<div className="sub">{[[x.city, x.state].filter(Boolean).join(", "), x.employer].filter(Boolean).join(" · ")}</div></td>
                      <td>{x.filerId ? <button className="tx-linkbtn" onClick={() => { setFilerId(x.filerId); setView("filers"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{x.recipient}</button> : x.recipient}<div className="sub">{x.office} · {x.county} County</div></td>
                      <td style={{ whiteSpace: "nowrap" }}>{x.date || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-num)", color: "var(--brass)" }}>{fmtUSD(x.amount)}</td>
                      <td><button className="tx-linkbtn" onClick={() => openDoc(x.docId)} title="Open the report this row came from"><SrcPill s={x.source} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === "review" && !docId && (
        <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px" }}>
            <h3 className="tx-h" style={{ margin: 0 }}>Waiting for a person</h3>
            <div className="tx-note" style={{ marginTop: 4 }}>
              {queue ? <>{fmtNum(queue.docCount)} report{queue.docCount === 1 ? "" : "s"} to look at; {fmtNum(queue.total)} row{queue.total === 1 ? "" : "s"} worth {fmtUSD(queue.amount)} {queue.total === 1 ? "is" : "are"} held out of every total.</> : "Loading."} A report lands here when the readers disagreed, a name or amount could not be confirmed a second way, or the form’s own totals did not add up — for its rows or for its receipts and balance figures. Open one to compare with the page.
            </div>
          </div>
          <div className="fec-table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
            <table className="fec-table">
              <thead><tr><th>Report</th><th>Filer</th><th>Read from</th><th style={{ textAlign: "right" }}>Rows to check</th><th style={{ textAlign: "right" }}>Amount held</th></tr></thead>
              <tbody>
                {queue?.docs.length === 0 && <tr><td colSpan={5} className="sub">Nothing is waiting. Reports that have not been read yet are listed under Counties and reader.</td></tr>}
                {queue?.docs.map((x) => (
                  <tr key={x.id}>
                    <td><button className="tx-linkbtn" style={{ fontWeight: 500 }} onClick={() => openDoc(x.id)}>{x.name || "Report"}</button><div className="sub">filed {x.submitted || "—"}{x.flags.length ? ` · ${x.flags.length} document-level warning${x.flags.length === 1 ? "" : "s"}` : ""}</div></td>
                    <td>{x.filer}<div className="sub">{x.office} · {x.county} County</div></td>
                    <td><SrcPill s={x.method === "text" ? "pdf-text" : "ocr"} /></td>
                    <td style={{ textAlign: "right" }}>{x.pending || ""}{x.figures === "check" && <div className="sub">report figures</div>}{!x.pending && x.figures !== "check" && x.flags.length > 0 && <div className="sub">warnings</div>}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-num)" }}>{x.amount ? fmtUSD(x.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "sources" && !docId && src && (
        <>
          <div className="tx-panel">
            <h3>Reading PDF reports</h3>
            {!r.tools.pdftotext ? <div className="tx-note warn">The PDF tools are missing from this build, so reports cannot be read.</div> : (
              <>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {r.running ? <>
                    <span className="fec-spin">{r.done} of {r.total} read{r.current ? ` · now: ${r.current.name || "report"}` : ""}</span>
                    <button className="fec-btn ghost sm" onClick={() => post("/api/tn/local/reader/stop").then(loadSrc)}>Stop after this report</button>
                  </> : <>
                    <label style={{ fontSize: 13, color: "var(--muted)" }}>Read the next <select style={inputStyle} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[10, 25, 100, 500, 5000].map((n) => <option key={n} value={n}>{n === 5000 ? "all" : n}</option>)}</select> reports in</label>
                    <button className="fec-btn" onClick={() => startReader({ subs: sub ? [sub] : src.home, limit, includeEfiled: false })}>{sub ? `${county?.county} County` : `my counties (${src.home.length})`} — PDF-only reports</button>
                    <button className="fec-btn ghost" onClick={() => startReader({ subs: sub ? [sub] : src.home, limit, includeEfiled: true })} title="Also reads the PDFs of reports filed online, which adds addresses, employers and report totals">include reports filed online</button>
                  </>}
                </div>
                <div className="tx-note">
                  Reports that exist only as a PDF (paper filings, and online filings the county’s search does not itemize) come first, newest first. A scanned page takes one to three minutes on this machine: it is read by <b>{r.models.vision}</b>, read again by <b>{r.models.verify || "no second model"}</b>, and printed text is cross-checked with Tesseract{r.tools.tesseract ? "" : " (not installed)"}.
                  Pages with a text layer take seconds ({r.models.text}). The reader stops if the app is restarted; start it again and it continues where it left off.
                  {r.last && !r.running && <> Last run: {r.last.done} of {r.last.total} in {Math.round(r.last.seconds / 60)} min{r.last.stopped ? " (stopped)" : ""}.</>}
                </div>
                {r.errors.length > 0 && <ul className="tx-note warn" style={{ paddingLeft: 18 }}>{r.errors.slice(-5).map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </>
            )}
          </div>
          <div className="tx-panel">
            <h3>A report from a county that is not online</h3>
            <form onSubmit={upload} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              {[["county", "County", 130, true], ["filer", "Candidate or committee (LAST, FIRST)", 240, true], ["office", "Office", 170, false], ["name", "Report (e.g. Pre-General 2026)", 200, false]].map(([k, label, w, req]) => (
                <label key={k} style={{ fontSize: 11, color: "var(--muted)" }}>{label}<input style={{ ...inputStyle, width: w, display: "block" }} value={up[k]} required={req} onChange={(e) => setUp({ ...up, [k]: e.target.value })} /></label>
              ))}
              <label style={{ fontSize: 11, color: "var(--muted)" }}>Date filed<input type="date" style={{ ...inputStyle, display: "block" }} value={up.filed} onChange={(e) => setUp({ ...up, filed: e.target.value })} /></label>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>PDF<input ref={fileRef} type="file" accept="application/pdf" style={{ display: "block", fontSize: 13, color: "var(--bone)" }} /></label>
              <button className="fec-btn">Upload and read</button>
            </form>
            <div className="tx-note">For reports you get from an election commission by records request. The file stays on this machine and goes through the same reader and review queue. {upMsg && <b>{upMsg}</b>}</div>
          </div>
          <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "12px 16px", alignItems: "center", flexWrap: "wrap" }}>
              <h3 className="tx-h" style={{ margin: 0 }}>Counties that publish online</h3>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="fec-btn ghost sm" disabled={src.sync.running} onClick={() => post("/api/tn/local/sync").then(loadSrc)}>Fetch all again</button>
                <button className="fec-btn ghost sm" onClick={() => post("/api/tn/local/discover").then((x) => { setErr(x.found.length ? null : "No new county portals found."); loadSrc(); }).catch((e) => setErr(e.message))} title="Checks all 95 counties for a portal that was not there before">Look for new counties</button>
              </span>
            </div>
            <div className="fec-table-wrap">
              <table className="fec-table">
                <thead><tr><th>Mine</th><th>County</th><th style={{ textAlign: "right" }}>Filers</th><th style={{ textAlign: "right" }}>Documents</th><th style={{ textAlign: "right" }}>Contributions online</th><th style={{ textAlign: "right" }}>PDF-only reports</th><th style={{ textAlign: "right" }}>Read</th><th style={{ textAlign: "right" }}>To review</th><th>Fetched</th></tr></thead>
                <tbody>{src.sources.map((s) => (
                  <tr key={s.sub}>
                    <td>{!s.uploads && <input type="checkbox" aria-label={`Watch ${s.county} County`} checked={src.home.includes(s.sub)} onChange={(e) => post("/api/tn/local/home", { subs: e.target.checked ? [...src.home, s.sub] : src.home.filter((x) => x !== s.sub) }).then(loadSrc)} />}</td>
                    <td><button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 500 }} onClick={() => { setSub(s.sub); setView("filers"); }}>{s.uploads ? "Uploaded by you" : s.county}</button> {s.url && <a className="fec-extlink" href={s.url} target="_blank" rel="noopener noreferrer">portal ↗</a>}{s.error && <div style={{ color: "var(--warn)", fontSize: 12 }}>{s.error}</div>}</td>
                    <td style={{ textAlign: "right" }}>{fmtNum(s.filers)}</td><td style={{ textAlign: "right" }}>{fmtNum(s.docs)}</td><td style={{ textAlign: "right" }}>{fmtNum(s.contribs)}</td>
                    <td style={{ textAlign: "right" }}>{fmtNum(s.paper)}</td><td style={{ textAlign: "right" }}>{fmtNum(s.read)}{s.failed ? <span style={{ color: "var(--warn)" }}> · {s.failed} failed</span> : ""}</td><td style={{ textAlign: "right" }}>{s.reviewDocs ? fmtNum(s.reviewDocs) : ""}</td>
                    <td className="sub">{s.syncedAt ? timeAgo(s.syncedAt) : "not yet"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="tx-note" style={{ padding: "0 16px 12px" }}>“Mine” counties are re-checked by the automatic Tennessee check (Directory), which alerts on new filings, and are the default for the reader. The other {95 - src.sources.filter((s) => !s.uploads).length} counties do not publish filings through this portal; their reports are on paper at each election commission.</div>
          </div>
        </>
      )}
    </>
  );
}
