// Tennessee → State dollars, Election results, bill votes, and the organization page that ties a
// company or group to incentives, contracts, lobbying, federal awards and campaign giving.
import { useEffect, useState } from "react";
import { fmtUSD, fmtUSDshort, fmtNum, timeAgo, downloadCSV, getJSON } from "./lib.js";

const inputStyle = { background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "7px 10px", fontSize: 13, borderRadius: "var(--radius-sm)", minWidth: 0 };
const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null))).toString();
const num = { textAlign: "right", fontFamily: "var(--font-num)" };
const srcName = (s) => (s === "tn" ? "state" : "federal");
function useFetch(url, deps) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => {
    if (!url) { setD(null); return undefined; }
    let live = true; setErr(null);
    const t = setTimeout(() => getJSON(url).then((x) => live && setD(x)).catch((e) => live && setErr(e.message)), 200);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line
  }, deps);
  return [d, err];
}

// =============================================================================================
//  Organization
// =============================================================================================
export function OrgPage({ name, onClose, onOpenLocal }) {
  const [d, err] = useFetch(name ? `/api/tn/org?${qs({ name })}` : null, [name]);
  if (!name) return null;
  const Section = ({ title, children, empty }) => (<div style={{ marginTop: 14 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>{empty ? <div className="sub">{empty}</div> : children}</div>);
  const emp = d?.employees, empTotal = emp ? emp.totals.reduce((a, t) => a + t.total, 0) : 0;
  return (
    <div className="tx-panel" style={{ borderTop: "3px solid var(--brass)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{name} <span className="sub" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>· what it gets, and what it and its people give</span></h3>
        <button className="fec-btn ghost sm" onClick={onClose}>Close</button>
      </div>
      {err && <div className="fec-error">{err}</div>}
      {!d && !err && <span className="fec-spin">Looking across state, federal and local records</span>}
      {d && (
        <>
          <div className="tx-kpis">
            <div className="tx-kpi"><span>State incentives</span><b>{fmtUSDshort(d.incentives.reduce((a, r) => a + r.total, 0))}</b><small>{d.incentives.length} FastTrack project{d.incentives.length === 1 ? "" : "s"}</small></div>
            <div className="tx-kpi"><span>State contracts</span><b>{fmtUSDshort(d.contracts.reduce((a, r) => a + r.amount, 0))}</b><small>{d.contracts.length} active</small></div>
            <div className="tx-kpi"><span>Federal awards in TN</span><b>{d.federal?.list?.length ? fmtUSDshort(d.federal.list.reduce((a, r) => a + r.amount, 0)) : "—"}</b><small>{d.federal?.fy ? `FY ${d.federal.fy}, by name` : d.federal?.error || ""}</small></div>
            <div className="tx-kpi"><span>Given by its people</span><b>{emp ? fmtUSDshort(empTotal) : "—"}</b><small>{emp ? `${fmtNum(emp.totals.reduce((a, t) => a + t.donors, 0))} donors list it as employer` : "no donors list it as employer"}</small></div>
          </div>
          <div className="tx-note">Matched by name after dropping suffixes like Inc and LLC, so subsidiaries and differently-written names are missed and unrelated organizations with the same name are merged. Two things being true of one name does not show that one caused the other.</div>
          <Section title="Lobbying">{d.lobbying ? <div className="sub">Registered as an employer of lobbyists at the state capitol{d.lobbying.year ? ` (${d.lobbying.year} roster)` : ""} — see Tennessee → Lobbying.</div> : <div className="sub">Not on the state lobbying roster under this name.</div>}</Section>
          <Section title="State incentives (FastTrack)" empty={!d.incentives.length && "None under this name since 2018."}>
            <table className="fec-table"><tbody>{d.incentives.map((r, i) => <tr key={i}><td>{r.landed || "—"}</td><td>{r.county} County · {r.type}{r.status === "pending" ? " · pending contract" : ""}</td><td className="sub">{fmtUSDshort(r.capital)} investment · {fmtNum(r.jn)} jobs</td><td style={num}>{fmtUSD(r.total)}</td></tr>)}</tbody></table>
          </Section>
          <Section title="State contracts" empty={!d.contracts.length && "No active state contract under this name."}>
            <table className="fec-table"><tbody>{d.contracts.slice(0, 25).map((r) => <tr key={r.contract}><td>#{r.contract}</td><td>{r.descr || r.type}<div className="sub">{r.type} · {r.begin} to {r.expire}</div></td><td style={num}>{fmtUSD(r.amount)}</td></tr>)}</tbody></table>
          </Section>
          {d.federal?.list?.length > 0 && <Section title={`Federal awards performed in Tennessee, FY ${d.federal.fy}`}><table className="fec-table"><tbody>{d.federal.list.map((r, i) => <tr key={i}><td>{r.name}</td><td style={num}>{fmtUSD(r.amount)}</td></tr>)}</tbody></table></Section>}
          <Section title="Where its people give" empty={!emp && "No stored contribution lists this employer."}>
            {emp && <div className="tx-cols" style={{ marginTop: 6 }}>
              <div><table className="fec-table"><tbody>{emp.recipients.slice(0, 25).map((r, i) => <tr key={i}><td>{r.name || r.id}<span className="sub"> · {srcName(r.source)}</span></td><td className="sub">{r.donors} donor{r.donors === 1 ? "" : "s"}</td><td style={num}>{fmtUSD(r.total)}</td></tr>)}</tbody></table></div>
              <div><table className="fec-table"><tbody>{emp.donors.slice(0, 25).map((r) => <tr key={r.key}><td>{r.name}<div className="sub">{r.occupation}</div></td><td className="sub">{r.gifts}×</td><td style={num}>{fmtUSD(r.total)}</td></tr>)}</tbody></table></div>
            </div>}
          </Section>
          <Section title="Given in its own name or its PAC’s" empty={!d.own && "Nothing stored under this name as a donor."}>
            {d.own && <><div className="sub">{d.own.names.join(" · ")}</div><table className="fec-table"><tbody>{d.own.recipients.slice(0, 30).map((r, i) => <tr key={i}><td>{r.name || r.id}<span className="sub"> · {srcName(r.source)}</span></td><td className="sub">{r.gifts}× · last {r.last || "—"}</td><td style={num}>{fmtUSD(r.total)}</td></tr>)}</tbody></table></>}
          </Section>
          {d.local.length > 0 && <Section title="County and city campaigns">
            <table className="fec-table"><tbody>{d.local.slice(0, 30).map((r, i) => <tr key={i}><td>{r.kind === "expenditure" ? "Paid by" : "Gave to"} {r.filerId ? <button className="tx-linkbtn" onClick={() => onOpenLocal?.(r.filerId)}>{r.recipient}</button> : r.recipient}<div className="sub">{r.office} · {r.county} County</div></td><td>{r.date || "—"}</td><td style={num}>{fmtUSD(r.amount)}</td></tr>)}</tbody></table>
          </Section>}
        </>
      )}
    </div>
  );
}

// =============================================================================================
//  State dollars
// =============================================================================================
export function StateDollars({ onOpenLocal }) {
  const [view, setView] = useState("incentives");
  const [q, setQ] = useState(""); const [county, setCounty] = useState(""); const [type, setType] = useState("");
  const [org, setOrg] = useState(null); const [orgQ, setOrgQ] = useState("");
  const [inc, e1] = useFetch(view === "incentives" ? `/api/tn/state/incentives?${qs({ q, county })}` : null, [view, q, county]);
  const [con, e2] = useFetch(view === "contracts" ? `/api/tn/state/contracts?${qs({ q, type })}` : null, [view, q, type]);
  const open = (name) => { setOrg(name); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const err = e1 || e2;
  const Pills = ({ r }) => <>{r.lobbies && <span className="tx-pill" title="On the state lobbying roster" style={{ marginLeft: 6 }}>lobbies</span>}{r.contracts > 0 && <span className="tx-pill" style={{ marginLeft: 6 }}>{r.contracts} contract{r.contracts === 1 ? "" : "s"}</span>}{r.incentives > 0 && <span className="tx-pill" style={{ marginLeft: 6 }}>incentive</span>}</>;
  return (
    <>
      <p className="tx-lede">Who the <b>State of Tennessee</b> pays: economic-development grants to companies, and the contracts it has in force. Open any name to see it beside <b>lobbying, federal awards and campaign giving</b>.</p>
      <div className="tx-panel">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="tx-subnav" role="tablist" aria-label="State dollars views" style={{ display: "inline-flex", margin: 0 }}>
            {[["incentives", "Incentives"], ["contracts", "Contracts"]].map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} onClick={() => { setView(id); setQ(""); }}>{label}</button>)}
          </div>
          {<input style={{ ...inputStyle, flex: 1, minWidth: 200, maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === "incentives" ? "Company" : "Supplier, description or contract number"} aria-label="Filter" />}
          {view === "incentives" && inc && <select style={inputStyle} value={county} onChange={(e) => setCounty(e.target.value)} aria-label="County"><option value="">Every county</option>{inc.counties.map((c) => <option key={c}>{c}</option>)}</select>}
          {view === "contracts" && con && <select style={{ ...inputStyle, maxWidth: 260 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Contract type"><option value="">Every type</option>{con.types.map((t) => <option key={t.type} value={t.type}>{t.type} ({t.n})</option>)}</select>}
          <form style={{ display: "flex", gap: 6, marginLeft: "auto" }} onSubmit={(e) => { e.preventDefault(); if (orgQ.trim().length > 2) open(orgQ.trim()); }}>
            <input style={{ ...inputStyle, width: 220 }} value={orgQ} onChange={(e) => setOrgQ(e.target.value)} placeholder="Look up any organization" aria-label="Organization name" /><button className="fec-btn ghost sm">Look up</button>
          </form>
        </div>
      </div>
      {err && <div className="fec-error" role="alert">{err}</div>}
      {org && <OrgPage name={org} onClose={() => setOrg(null)} onOpenLocal={onOpenLocal} />}

      {view === "incentives" && !inc && !err && <div className="fec-empty"><span className="fec-spin">Reading the FastTrack project database</span></div>}
      {view === "incentives" && inc && (
        <>
          <div className="tx-kpis">
            <div className="tx-kpi"><span>FastTrack grants</span><b>{fmtUSDshort(inc.totals.total)}</b><small>{fmtNum(inc.totals.n)} projects since 2018</small></div>
            <div className="tx-kpi"><span>Capital investment pledged</span><b>{fmtUSDshort(inc.totals.capital)}</b></div>
            <div className="tx-kpi"><span>New jobs pledged</span><b>{fmtNum(inc.totals.jobs)}</b><small>{inc.totals.jobs ? `${fmtUSD(inc.totals.total / inc.totals.jobs)} of grant per job` : ""}</small></div>
          </div>
          <div className="tx-cols" style={{ gridTemplateColumns: "minmax(0, 2.2fr) minmax(240px, 1fr)" }}>
            <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
              <div className="fec-table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
                <table className="fec-table">
                  <thead><tr><th>Company</th><th>County</th><th>Landed</th><th style={{ textAlign: "right" }}>Jobs</th><th style={{ textAlign: "right" }}>Grants</th></tr></thead>
                  <tbody>{inc.rows.map((r, i) => (
                    <tr key={i}><td><button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 500 }} onClick={() => open(r.company)}>{r.company}</button><Pills r={r} /><div className="sub">{r.type} · {fmtUSDshort(r.capital)} investment{r.status === "pending" ? " · pending contract" : ""}</div></td>
                      <td>{r.county}</td><td style={{ whiteSpace: "nowrap" }}>{r.landed || "—"}</td><td style={num}>{fmtNum(r.jn)}</td><td style={{ ...num, color: "var(--brass)" }}>{fmtUSD(r.total)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="tx-panel"><h3>By county</h3><ol className="tx-rank">{inc.byCounty.slice(0, 30).map((c) => <li key={c.name}><span className="nm"><button onClick={() => setCounty(c.name)}>{c.name}</button><span className="sub"> · {c.count}</span></span><span className="amt">{fmtUSDshort(c.total)}</span></li>)}</ol></div>
          </div>
          <div className="tx-note">Source: <a className="fec-extlink" href={inc.source} target="_blank" rel="noopener noreferrer">TNECD FastTrack project database ↗</a>{inc.file ? ` (${inc.file})` : ""}{inc.syncedAt ? ` · read ${timeAgo(inc.syncedAt)}` : ""}. Grants only: tax credits are confidential and capital grants outside FastTrack are not listed. <button className="tx-linkbtn" onClick={() => downloadCSV("tn-fasttrack.csv", ["Company", "County", "Landed", "Type", "Capital", "New jobs", "Grants", "Status"], inc.rows.map((r) => [r.company, r.county, r.landed, r.type, r.capital, r.jn, r.total, r.status]))}>CSV</button></div>
        </>
      )}

      {view === "contracts" && !con && !err && <div className="fec-empty"><span className="fec-spin">Reading the state’s contract list</span></div>}
      {view === "contracts" && con && (
        <>
          <div className="tx-kpis">
            <div className="tx-kpi"><span>Contracts in force</span><b>{fmtNum(con.totals.n)}</b><small>{fmtNum(con.totals.suppliers)} suppliers</small></div>
            <div className="tx-kpi"><span>Maximum value</span><b>{fmtUSDshort(con.totals.amount)}</b><small>ceilings, not payments</small></div>
          </div>
          <div className="tx-cols" style={{ gridTemplateColumns: "minmax(0, 2.2fr) minmax(240px, 1fr)" }}>
            <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
              <div className="fec-table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
                <table className="fec-table">
                  <thead><tr><th>Supplier</th><th>Contract</th><th>Term</th><th style={{ textAlign: "right" }}>Maximum</th></tr></thead>
                  <tbody>{con.rows.map((r) => (
                    <tr key={`${r.contract}-${r.supplier}`}><td><button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 500 }} onClick={() => open(r.supplier)}>{r.supplier}</button><Pills r={r} /></td>
                      <td>{r.descr || <span className="sub">no description</span>}<div className="sub">#{r.contract} · {r.type}</div></td><td className="sub" style={{ whiteSpace: "nowrap" }}>{r.begin}<br />{r.expire}</td><td style={{ ...num, color: "var(--brass)" }}>{fmtUSD(r.amount)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="tx-panel"><h3>Largest suppliers</h3><ol className="tx-rank">{con.top.slice(0, 30).map((c) => <li key={c.norm}><span className="nm"><button onClick={() => open(c.name)}>{c.name}</button><span className="sub"> · {c.count}{c.lobbies ? " · lobbies" : ""}</span></span><span className="amt">{fmtUSDshort(c.total)}</span></li>)}</ol></div>
          </div>
          <div className="tx-note">Source: <a className="fec-extlink" href={con.source} target="_blank" rel="noopener noreferrer">Central Procurement Office, All Contracts ↗</a>{con.syncedAt ? ` · read ${timeAgo(con.syncedAt)}` : ""}. Active contracts with their maximum liability; “Delegated Contracts” rows are agency purchasing authority, not a supplier. Largest {con.rows.length} shown.</div>
        </>
      )}

    </>
  );
}

// =============================================================================================
//  Election results
// =============================================================================================
export function Results({ onCandidate }) {
  const [list, e0] = useFetch("/api/tn/results/elections", []);
  const [el, setEl] = useState(""); const [office, setOffice] = useState(null); const [county, setCounty] = useState("");
  useEffect(() => { if (list?.elections?.length && !el) setEl(list.elections[0].id); }, [list, el]);
  const [idx, e1] = useFetch(el ? `/api/tn/results?${qs({ election: el })}` : null, [el]);
  const [d, e2] = useFetch(el && office ? `/api/tn/results?${qs({ election: el, office: office.office, type: office.etype, county })}` : null, [el, office?.office, office?.etype, county]);
  const err = e0 || e1 || e2;
  return (
    <>
      <p className="tx-lede">Votes beside the money: official precinct results from the Secretary of State, totalled by county. Pick an election and a race; open a candidate to see who funded them.</p>
      <div className="tx-panel">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select style={inputStyle} value={el} onChange={(e) => { setEl(e.target.value); setOffice(null); setCounty(""); }} aria-label="Election">{list?.elections.map((x) => <option key={x.id} value={x.id}>{x.date}</option>)}</select>
          {idx && <select style={{ ...inputStyle, maxWidth: 420 }} value={office ? `${office.office}|${office.etype}` : ""} onChange={(e) => { const [o, t] = e.target.value.split("|"); setOffice(e.target.value ? { office: o, etype: t } : null); setCounty(""); }} aria-label="Race">
            <option value="">Choose a race ({idx.offices.length})</option>{idx.offices.map((o) => <option key={`${o.office}|${o.etype}`} value={`${o.office}|${o.etype}`}>{o.office}{o.etype ? ` — ${o.etype}` : ""}</option>)}</select>}
          {d && d.counties.length > 1 && <select style={inputStyle} value={county} onChange={(e) => setCounty(e.target.value)} aria-label="County"><option value="">All {d.counties.length} counties</option>{d.counties.map((c) => <option key={c.name}>{c.name}</option>)}</select>}
          {el && !idx && !err && <span className="fec-spin">Loading the precinct spreadsheet (first time takes up to a minute)</span>}
        </div>
      </div>
      {err && <div className="fec-error" role="alert">{err}</div>}
      {d && (
        <div className="tx-cols" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)" }}>
          <div className="tx-panel">
            <h3>{d.office} <span className="sub" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>· {fmtNum(d.total)} votes{county ? ` in ${county} County` : ""}</span></h3>
            <ol className="tx-rank">{d.candidates.map((c) => (
              <li key={c.candidate}><span className="nm">{/^(write-in|retain|replace)/i.test(c.candidate) ? c.candidate : <button onClick={() => onCandidate?.(c.candidate)} title="Open this candidate’s donors">{c.candidate}</button>}<span className="sub"> · {c.party || "—"}</span></span>
                <span className="amt">{fmtNum(c.votes)} · {(c.share * 100).toFixed(1)}%</span><span className="meter"><i style={{ width: `${Math.max(1, c.share * 100)}%` }} /></span></li>
            ))}</ol>
          </div>
          <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="fec-table-wrap" style={{ maxHeight: 560, overflowY: "auto" }}>
              <table className="fec-table"><thead><tr><th>County</th><th>Leader</th><th style={{ textAlign: "right" }}>Leader’s votes</th><th style={{ textAlign: "right" }}>All votes</th></tr></thead>
                <tbody>{d.counties.map((c) => <tr key={c.name}><td><button className="tx-linkbtn" style={{ color: "var(--bone)" }} onClick={() => setCounty(c.name)}>{c.name}</button></td><td>{c.leader}</td><td style={num}>{fmtNum(c.leaderVotes)}{c.total ? ` · ${((c.leaderVotes / c.total) * 100).toFixed(0)}%` : ""}</td><td style={num}>{fmtNum(c.total)}</td></tr>)}</tbody></table>
            </div>
          </div>
        </div>
      )}
      <div className="tx-note">Source: <a className="fec-extlink" href="https://sos.tn.gov/elections/results" target="_blank" rel="noopener noreferrer">Tennessee Secretary of State, election results ↗</a>. State and federal races only; county and city races are not in these files.</div>
    </>
  );
}

// =============================================================================================
//  Bill votes (used inside Legislature)
// =============================================================================================
export function BillVotes({ seed }) {
  const [input, setInput] = useState(""); const [ga, setGa] = useState("114"); const [ask, setAsk] = useState(null);
  useEffect(() => { if (seed?.number) { setInput(seed.number); setGa(String(seed.ga || "114")); setAsk({ number: seed.number, ga: String(seed.ga || "114") }); } }, [seed?.number, seed?.ga, seed?.t]);
  const [d, err] = useFetch(ask ? `/api/tn/legislature/bill?${qs(ask)}` : null, [ask?.number, ask?.ga]);
  return (
    <div className="tx-panel">
      <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); if (input.trim()) setAsk({ number: input.trim(), ga }); }}>
        <b style={{ fontSize: 13 }}>How did they vote?</b>
        <input style={{ ...inputStyle, width: 150 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="HB0364 or SB650" aria-label="Bill number" />
        <select style={inputStyle} value={ga} onChange={(e) => setGa(e.target.value)} aria-label="General Assembly">{["115", "114", "113", "112"].map((g) => <option key={g} value={g}>{g}th General Assembly</option>)}</select>
        <button className="fec-btn ghost sm">Show votes</button>
        {ask && !d && !err && <span className="fec-spin">Reading the bill page</span>}
      </form>
      {err && <div className="fec-error" role="alert">{err}</div>}
      {d && (
        <div style={{ marginTop: 10 }}>
          <div><a className="fec-extlink" href={d.url} target="_blank" rel="noopener noreferrer">{d.bill} ↗</a>{d.companion.length ? <span className="sub"> · companion {d.companion.join(", ")}</span> : null} <span className="sub">{d.title}</span></div>
          {d.votes.length === 0 && <div className="tx-note">No recorded votes on this bill.</div>}
          {d.votes.map((v, i) => (
            <div key={i} style={{ marginTop: 10, borderLeft: `3px solid ${/pass|adopt|concur/i.test(v.result) && !/fail/i.test(v.result) ? "var(--olive)" : "var(--warn)"}`, paddingLeft: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{v.body} <span className="sub" style={{ fontWeight: 400 }}>· {v.date || ""} · {v.result} · {v.ayes ?? "—"} aye, {v.noes ?? "—"} no{v.pnv ? `, ${v.pnv} present not voting` : ""}</span></div>
              <div className="sub">{v.action}</div>
              {v.no.length > 0 && <div style={{ fontSize: 13 }}><b>No:</b> {v.no.join(", ")}</div>}
              {v.present.length > 0 && <div style={{ fontSize: 13 }}><b>Present, not voting:</b> {v.present.join(", ")}</div>}
              {v.aye.length > 0 && <details><summary className="sub" style={{ cursor: "pointer" }}>Aye ({v.aye.length})</summary><div style={{ fontSize: 13 }}>{v.aye.join(", ")}</div></details>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================================
//  IRS filings for a group (used inside Outside spending)
// =============================================================================================
export function NonprofitLookup({ seed }) {
  const [q, setQ] = useState(""); const [ask, setAsk] = useState(""); const [ein, setEin] = useState(null); const [all, setAll] = useState(false);
  useEffect(() => { if (seed?.name) { setQ(seed.name); setAsk(seed.name); setEin(null); } }, [seed?.name, seed?.t]);
  const [list, e1] = useFetch(ask ? `/api/tn/nonprofit?${qs({ q: ask, all: all ? "1" : "" })}` : null, [ask, all]);
  const [org, e2] = useFetch(ein ? `/api/tn/nonprofit?ein=${ein}` : null, [ein]);
  return (
    <div className="tx-panel">
      <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); setEin(null); setAsk(q.trim()); }}>
        <b style={{ fontSize: 13 }}>Who is behind a group?</b>
        <input style={{ ...inputStyle, flex: 1, minWidth: 200, maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name of a nonprofit or advocacy group" aria-label="Group name" />
        <label style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> outside Tennessee too</label>
        <button className="fec-btn ghost sm">Search IRS filings</button>
      </form>
      {(e1 || e2) && <div className="tx-note warn">{e1 || e2}</div>}
      {list && !ein && (list.orgs.length === 0 ? <div className="tx-note">Nothing on file with the IRS under that name{all ? "" : " in Tennessee"}. Groups organized as PACs or LLCs do not file these returns.</div>
        : <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{list.orgs.map((o) => <button key={o.ein} className="fec-chip" onClick={() => setEin(o.ein)}>{o.name} · {o.city}, {o.state}{o.subsection ? ` · 501(c)(${o.subsection})` : ""}</button>)}</div>)}
      {org && (
        <div style={{ marginTop: 10 }}>
          <div><a className="fec-extlink" href={org.url} target="_blank" rel="noopener noreferrer">{org.org.name} ↗</a> <span className="sub">{org.org.city}, {org.org.state}{org.org.subsection ? ` · 501(c)(${org.org.subsection})` : ""} · EIN {org.org.ein}</span> <button className="tx-linkbtn" onClick={() => setEin(null)}>back to results</button></div>
          {org.filings.length === 0 ? <div className="tx-note">No return data on file.</div> : (
            <table className="fec-table" style={{ marginTop: 6 }}><thead><tr><th>Tax year</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Contributions received</th><th style={{ textAlign: "right" }}>Expenses</th><th style={{ textAlign: "right" }}>Assets</th><th></th></tr></thead>
              <tbody>{org.filings.map((f) => <tr key={f.year}><td>{f.year}</td><td style={num}>{fmtUSD(f.revenue)}</td><td style={num}>{fmtUSD(f.contributions)}</td><td style={num}>{fmtUSD(f.expenses)}</td><td style={num}>{fmtUSD(f.assets)}</td><td>{f.pdf && <a className="fec-extlink" href={f.pdf} target="_blank" rel="noopener noreferrer">return ↗</a>}</td></tr>)}</tbody></table>
          )}
          <div className="tx-note">From IRS Form 990 data via ProPublica’s Nonprofit Explorer. 501(c)(4) groups do not have to name their donors, so this shows size and spending, not who paid.</div>
        </div>
      )}
    </div>
  );
}

// =============================================================================================
//  Statements of Disclosure of Interests (used inside Legislature)
// =============================================================================================
export function Interests({ seed }) {
  const y = new Date().getFullYear();
  const [f, setF] = useState({ last: "", first: "", year: String(y), scope: "state", county: "" }); const [ask, setAsk] = useState(null); const [open, setOpen] = useState(null);
  useEffect(() => { if (seed?.last) { const next = { last: seed.last, first: "", year: String(y), scope: "state", county: "" }; setF(next); setAsk(next); setOpen(null); } /* eslint-disable-next-line */ }, [seed?.last, seed?.t]);
  const [d, e1] = useFetch(ask ? `/api/tn/interests?${qs(ask)}` : null, [ask]);
  const [st, e2] = useFetch(open ? `/api/tn/interests/view?${qs(open)}` : null, [open]);
  return (
    <div className="tx-panel">
      <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); setOpen(null); setAsk({ ...f }); }}>
        <b style={{ fontSize: 13 }}>Their own money</b>
        <input style={{ ...inputStyle, width: 150 }} value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} placeholder="Last name" aria-label="Last name" />
        <select style={inputStyle} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} aria-label="Level"><option value="state">State officials</option><option value="local">Local officials</option></select>
        {f.scope === "local" && <input style={{ ...inputStyle, width: 130 }} value={f.county} onChange={(e) => setF({ ...f, county: e.target.value })} placeholder="County (optional)" aria-label="County" />}
        <select style={inputStyle} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} aria-label="Report year">{Array.from({ length: 8 }, (_, i) => String(y - i)).map((v) => <option key={v}>{v}</option>)}</select>
        <button className="fec-btn ghost sm">Find disclosure</button>
        {ask && !d && !e1 && <span className="fec-spin">Asking the Ethics Commission</span>}
      </form>
      {(e1 || e2) && <div className="tx-note warn">{e1 || e2}</div>}
      {d && !open && (d.rows.length === 0 ? <div className="tx-note">No statement filed under that name for {d.year}.</div>
        : <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{d.rows.map((r, i) => <button key={i} className="fec-chip" onClick={() => setOpen(r.q)}>{r.name} · {r.position}</button>)}{d.more && <span className="sub">More matched; narrow the name.</span>}</div>)}
      {st && open && (
        <div style={{ marginTop: 10 }}>
          <div><a className="fec-extlink" href={st.url} target="_blank" rel="noopener noreferrer">{st.filer || "Statement"} ↗</a> <span className="sub">{st.position} · report year {st.year} · filed {st.filed}</span> <button className="tx-linkbtn" onClick={() => setOpen(null)}>back to results</button></div>
          <div className="tx-cols" style={{ marginTop: 8 }}>
            {st.sections.filter((x) => !x.none).map((x) => <div key={x.title}><div style={{ fontWeight: 600, fontSize: 13 }}>{x.title}</div>{x.lines.filter((l) => !/^part [ab]$/i.test(l) && !/^none$/i.test(l)).map((l, i) => <div key={i} style={{ fontSize: 13 }}>{l}</div>)}</div>)}
          </div>
          <div className="sub" style={{ marginTop: 6 }}>Nothing reported under: {st.sections.filter((x) => x.none).map((x) => x.title).join(", ") || "—"}.</div>
          <div className="tx-note">The Statement of Disclosure of Interests names sources of income and holdings, not amounts.</div>
        </div>
      )}
    </div>
  );
}
