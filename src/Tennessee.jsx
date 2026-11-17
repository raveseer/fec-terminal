// Tennessee hub — every way this app can search Tennessee, under one tab:
//   Registry         the existing per-entity TREF workspace (reports, ledgers, AI, tracking)
//   Directory        local index of every candidate & PAC TREF has on file
//   Money search     the full TREF contributions/expenditures search (every form field)
//   Filings          the TREF report search
//   Federal races    FEC totals for every Tennessee U.S. House / Senate candidate
//   Federal dollars  USAspending.gov — contracts, grants, loans and payments landing in Tennessee
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUSD, fmtUSDshort, fmtNum, timeAgo, partyColor, downloadCSV, getJSON } from "./lib.js";

const SECTIONS = [
  ["candidate", "Candidate donors"],
  ["registry", "Registry"],
  ["directory", "Directory"],
  ["money", "Money search"],
  ["filings", "Filings"],
  ["races", "Federal races"],
  ["dollars", "Federal dollars"],
];

const qsOf = (obj) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null && v !== false) qs.set(k, v === true ? "1" : String(v));
  return qs.toString();
};

function useMeta() {
  const [meta, setMeta] = useState(null);
  useEffect(() => { getJSON("/api/tn/meta").then(setMeta).catch(() => setMeta({ years: [], offices: [], parties: [], reportYears: [], reportTypes: [], counties: {} })); }, []);
  return meta;
}

function useDistricts(office) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let live = true;
    setList([]);
    if (!office) return undefined;
    getJSON(`/api/tn/districts?office=${encodeURIComponent(office)}`).then((d) => { if (live) setList(d.districts || []); }).catch(() => {});
    return () => { live = false; };
  }, [office]);
  return list;
}

const PartyPill = ({ party }) => {
  if (!party || /^none$/i.test(party)) return null;
  const cls = /^dem/i.test(party) ? "dem" : /^rep/i.test(party) ? "rep" : "";
  return <span className={`tx-pill ${cls}`}>{party}</span>;
};

function Rank({ title, items, onPick, color }) {
  if (!items?.length) return null;
  const max = Math.max(...items.map((i) => Math.abs(i.total ?? i.amount ?? 0)), 1);
  return (
    <div className="tx-panel">
      <h3>{title}</h3>
      <ol className="tx-rank">
        {items.map((it, i) => {
          const amt = it.total ?? it.amount ?? 0;
          return (
            <li key={`${it.name}-${i}`} style={color ? { "--bar": color } : undefined}>
              <span className="nm" title={it.name}>
                {onPick ? <button onClick={() => onPick(it)}>{it.name}</button> : it.name}
                {it.count != null && <span className="sub"> · {fmtNum(it.count)}</span>}
              </span>
              <span className="amt">{fmtUSDshort(amt)}</span>
              <span className="meter"><i style={{ width: `${Math.max(1, (Math.abs(amt) / max) * 100)}%` }} /></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// =============================================================================================
//  Directory
// =============================================================================================
function Directory({ meta, onOpenEntity }) {
  const [f, setF] = useState({ q: "", kind: "", office: "", district: "", party: "", year: "", city: "", zip: "", winner: "", open: false });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [sync, setSync] = useState(null);
  const PER = 100;
  const set = (k) => (e) => { setPage(0); setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value })); };

  const load = async () => {
    setLoading(true); setError(null);
    try { setData(await getJSON(`/api/tn/directory?${qsOf({ ...f, limit: PER, offset: page * PER })}`)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  // local search — debounce typing, no upstream calls involved
  useEffect(() => { const t = setTimeout(load, 180); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [JSON.stringify(f), page]);

  const pollRef = useRef(null);
  const pollSync = async () => {
    try {
      const s = await getJSON("/api/tn/directory/sync");
      setSync(s);
      if (s.running) pollRef.current = setTimeout(pollSync, 2000);
      else if (s.finishedAt) load();
    } catch { /* next click retries */ }
  };
  useEffect(() => { pollSync(); return () => clearTimeout(pollRef.current); /* eslint-disable-next-line */ }, []);
  const startSync = async (scope) => {
    try {
      await getJSON("/api/tn/directory/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope }) });
      clearTimeout(pollRef.current);
      pollSync();
    } catch (e) { setError(e.message); }
  };

  const stats = data?.stats || sync?.stats;
  const lastSync = stats?.scopes?.[0]?.syncedAt;
  const rows = data?.rows || [];
  const officeLabels = (meta?.offices || []).map((o) => o.label);
  const yearLabels = [...new Set((meta?.years || []).map((y) => y.label.slice(0, 4)))];
  const exportCsv = () => downloadCSV("tn_directory.csv",
    ["name", "type", "office", "district", "party", "election_year", "city", "zip", "treasurer", "primary", "general", "created", "closed", "tref_id"],
    rows.map((r) => [r.name, r.kind, r.office, r.district, r.party, r.year, r.city, r.zip, r.treasurer, r.primaryResult, r.generalResult, r.created, r.closed, r.tnId]));

  return (
    <>
      <p className="tx-lede">
        A local copy of every candidate and PAC on file with the Tennessee Registry of Election Finance. Searching here is instant and
        never touches apps.tn.gov — it matches <b>any part</b> of a name, treasurer, officer, city, ZIP or email.
      </p>
      <div className="tx-panel">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{fmtNum(stats?.entities ?? 0)}</b> entities stored
            <span className="sub"> · {fmtNum(stats?.rows ?? 0)} registrations{lastSync ? ` · last synced ${timeAgo(lastSync)}` : ""}</span>
          </div>
          <button className="fec-btn ghost" disabled={sync?.running} onClick={() => startSync("current")}
            title="Re-reads the open election cycles and the PAC roster from TREF (a handful of requests)">Sync current cycles</button>
          <button className="fec-btn ghost" disabled={sync?.running} onClick={() => startSync("all")}
            title="One search per election year back to 2002. Closed years are only fetched once, ever.">Sync every year since 2002</button>
        </div>
        {sync?.running && (
          <>
            <div className="tx-progress"><i style={{ width: `${sync.total ? (sync.done / sync.total) * 100 : 5}%` }} /></div>
            <div className="tx-note">Reading {sync.current || "…"} ({sync.done} of {sync.total}) — requests are spaced out to stay polite to the state site.</div>
          </>
        )}
        {!sync?.running && sync?.finishedAt && (
          <div className="tx-note">Last sync finished {timeAgo(sync.finishedAt)}: {fmtNum(sync.added)} rows written{sync.errors?.length ? ` · ${sync.errors.length} failed` : ""}.</div>
        )}
        {sync?.errors?.length > 0 && <div className="tx-note warn">{sync.errors.slice(-3).join(" · ")}</div>}
      </div>

      <div className="tx-panel">
        <div className="tx-form">
          <div className="fec-field wide">
            <label htmlFor="dir-q">Search</label>
            <input id="dir-q" value={f.q} onChange={set("q")} placeholder="Name, treasurer, officer, city, ZIP, email…" />
          </div>
          <div className="fec-field">
            <label htmlFor="dir-kind">Type</label>
            <select id="dir-kind" value={f.kind} onChange={set("kind")}>
              <option value="">Candidates and PACs</option><option value="candidate">Candidates</option><option value="pac">PACs</option>
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="dir-office">Office</label>
            <select id="dir-office" value={f.office} onChange={set("office")}>
              <option value="">Any office</option>{officeLabels.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="dir-district">District</label>
            <input id="dir-district" value={f.district} onChange={set("district")} placeholder="e.g. 7" inputMode="numeric" />
          </div>
          <div className="fec-field">
            <label htmlFor="dir-party">Party</label>
            <select id="dir-party" value={f.party} onChange={set("party")}>
              <option value="">Any party</option>{(meta?.parties || []).map((p) => <option key={p.id} value={p.label}>{p.label}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="dir-year">Election year</label>
            <select id="dir-year" value={f.year} onChange={set("year")}>
              <option value="">Any year</option>{yearLabels.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="dir-city">City</label>
            <input id="dir-city" value={f.city} onChange={set("city")} placeholder="e.g. Kingsport" />
          </div>
          <div className="fec-field">
            <label htmlFor="dir-zip">ZIP starts with</label>
            <input id="dir-zip" value={f.zip} onChange={set("zip")} placeholder="e.g. 376" inputMode="numeric" />
          </div>
          <div className="fec-field">
            <label htmlFor="dir-winner">Election result</label>
            <select id="dir-winner" value={f.winner} onChange={set("winner")}>
              <option value="">Any</option><option value="primary">Won the primary</option><option value="general">Won the general</option>
            </select>
          </div>
          <label className="fec-check" style={{ minHeight: 36 }}>
            <input type="checkbox" checked={f.open} onChange={set("open")} /> Hide closed accounts
          </label>
        </div>
      </div>

      {error && <div className="fec-error" role="alert">{error}</div>}
      <div className="fec-status">
        <span>{loading && !data ? "Searching…" : `${fmtNum(data?.total ?? 0)} match${data?.total === 1 ? "" : "es"}`}</span>
        <button className="fec-btn ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV ({rows.length})</button>
      </div>
      {data && data.total === 0 && (
        <div className="fec-empty">
          {(stats?.rows ?? 0) === 0
            ? "The directory is empty. Run “Sync current cycles” above to load this cycle’s candidates and every registered PAC."
            : "Nothing stored matches those filters. If the entity is from an older election, run “Sync every year since 2002”."}
        </div>
      )}
      {rows.length > 0 && (
        <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
          <div className="fec-table-wrap">
            <table className="fec-table">
              <thead><tr><th>Name</th><th>Office</th><th>Party</th><th>Year</th><th>Location</th><th>Treasurer</th><th>Result</th><th>Account</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.tnId}-${r.year}`}>
                    <td>
                      <button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 600 }} onClick={() => onOpenEntity(r.name.split(",")[0])}
                        title="Open in the Registry: reports, itemized ledger, money flows">{r.name}</button>
                      <div className="sub">{r.kind === "pac" ? "PAC" : "Candidate"}{r.email ? ` · ${r.email}` : ""}</div>
                    </td>
                    <td>{r.office || "—"}{r.district ? <span className="sub"> · district {r.district}</span> : null}</td>
                    <td><PartyPill party={r.party} /></td>
                    <td>{r.year || "—"}</td>
                    <td>{[r.city, r.zip].filter(Boolean).join(" ") || "—"}</td>
                    <td>{r.treasurer || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {/\(W\)/.test(r.primaryResult || "") && <span className="tx-pill win">Primary ✓</span>}{" "}
                      {/\(W\)/.test(r.generalResult || "") && <span className="tx-pill win">General ✓</span>}
                      {!/\(W\)/.test(`${r.primaryResult}${r.generalResult}`) && <span className="sub">—</span>}
                    </td>
                    <td className="sub">{r.closed ? `closed ${r.closed}` : r.created ? `opened ${r.created}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data && data.total > PER && (
        <div className="fec-pager">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>◂ Prev</button>
          <span className="fec-tag">page {page + 1} / {Math.ceil(data.total / PER)}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PER >= data.total}>Next ▸</button>
        </div>
      )}
    </>
  );
}

// =============================================================================================
//  Money search — the full contributions / expenditures form
// =============================================================================================
function MoneySearch({ meta, onOpenEntity }) {
  const nowY = new Date().getFullYear();
  const [kind, setKind] = useState("contributions");
  const [years, setYears] = useState([String(nowY), String(nowY - 1)]);
  const [f, setF] = useState({ recipient: "", contributor: "", employer: "", occupation: "", zip: "", by: "", vendor: "", vendorZip: "", purpose: "",
    typeOf: "all", amountOp: "greater", amount: "", toType: "both", contains: true });
  const [reportTypes, setReportTypes] = useState([]);
  const [from, setFrom] = useState({ fromCandidate: true, fromPac: true, fromIndividual: true, fromOrg: true });
  const [more, setMore] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(100);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const yearOpts = (meta?.reportYears?.length ? meta.reportYears : Array.from({ length: 10 }, (_, i) => String(nowY - i))).slice(0, 12);
  const toggleYear = (y) => setYears((p) => (p.includes(y) ? p.filter((x) => x !== y) : [...p, y].sort().reverse()));

  const run = async (refresh = false) => {
    setLoading(true); setError(null); setShown(100);
    try {
      const params = { kind, years: years.join(","), ...f, contains: f.contains ? "1" : "0", reportTypes: reportTypes.join(",") };
      for (const [k, v] of Object.entries(from)) if (!v) params[k] = "0";
      if (refresh) params._refresh = "1";
      setData(await getJSON(`/api/tn/explore/money?${qsOf(params)}`));
    } catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  };
  const onKey = (e) => { if (e.key === "Enter") run(); };
  const isExp = kind === "expenditures";
  const txt = (id, label, key, ph) => (
    <div className="fec-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={f[key]} onChange={set(key)} onKeyDown={onKey} placeholder={ph} />
    </div>
  );
  const colIdx = (re) => (data?.headers || []).findIndex((h) => re.test(h));
  const keep = useMemo(() => {
    if (!data?.headers) return [];
    // hide columns that are empty for every row (the export carries both the contribution and expenditure column sets)
    return data.headers.map((_, i) => i).filter((i) => data.rows.some((r) => String(r[i] || "").trim()));
  }, [data]);

  return (
    <>
      <p className="tx-lede">
        Search every itemized contribution and expenditure filed with the state — by <b>who gave</b>, <b>who received</b>, employer, occupation,
        ZIP code, vendor, purpose or dollar amount, across several report years at once. Results are saved, so repeating a search costs nothing.
      </p>
      <div className="tx-panel">
        <div className="tx-form">
          <div className="fec-field">
            <label>Find</label>
            <div className="tx-seg" role="group" aria-label="Transaction kind">
              <button aria-pressed={!isExp} onClick={() => setKind("contributions")}>Contributions</button>
              <button aria-pressed={isExp} onClick={() => setKind("expenditures")}>Expenditures</button>
            </div>
          </div>
          <div className="fec-field wide">
            <label>Report years</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {yearOpts.map((y) => (
                <button key={y} className="fec-chip" onClick={() => toggleYear(y)} aria-pressed={years.includes(y)}
                  style={years.includes(y) ? { borderColor: "var(--brass)", color: "var(--brass)" } : undefined}>{y}</button>
              ))}
            </div>
          </div>
          {!isExp ? (
            <>
              {txt("ms-contrib", "Contributor (person, business or PAC)", "contributor", "e.g. haslam, realtors")}
              {txt("ms-recip", "Recipient (candidate or PAC)", "recipient", "e.g. lee, crowe")}
              {txt("ms-emp", "Contributor’s employer", "employer", "e.g. eastman, ballad")}
              {txt("ms-occ", "Contributor’s occupation", "occupation", "e.g. lobbyist, physician")}
              {txt("ms-zip", "Contributor’s ZIP code", "zip", "e.g. 37656")}
            </>
          ) : (
            <>
              {txt("ms-by", "Spent by (candidate or PAC)", "by", "e.g. house republican caucus")}
              {txt("ms-vendor", "Paid to (vendor, candidate or PAC)", "vendor", "e.g. targeted victory")}
              {txt("ms-purpose", "Purpose", "purpose", "e.g. consulting, advertising")}
              {txt("ms-vzip", "Vendor’s ZIP code", "vendorZip", "e.g. 37219")}
            </>
          )}
          <div className="fec-field">
            <label htmlFor="ms-amt">Amount</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={f.amountOp} onChange={set("amountOp")} aria-label="Amount comparison" style={{ width: 118, flexShrink: 0 }}>
                <option value="greater">more than</option><option value="less">less than</option><option value="equal">exactly</option>
              </select>
              <input id="ms-amt" value={f.amount} onChange={set("amount")} onKeyDown={onKey} placeholder="$" inputMode="decimal" />
            </div>
          </div>
          <div className="fec-field">
            <label htmlFor="ms-type">Type</label>
            <select id="ms-type" value={f.typeOf} onChange={set("typeOf")}>
              <option value="all">All</option><option value="monetary">Monetary</option><option value="inkind">In-kind</option>
              <option value="independent">Independent expenditures</option>
            </select>
          </div>
          <div className="full" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button className="fec-btn" onClick={() => run()} disabled={loading || !years.length}>{loading ? "Searching…" : "Search"}</button>
            <label className="fec-check" title="TREF matches the start of a name unless a wildcard is used; this adds one for you">
              <input type="checkbox" checked={f.contains} onChange={set("contains")} /> Match anywhere in a name
            </label>
            <button className="tx-linkbtn" onClick={() => setMore((v) => !v)}>{more ? "Fewer filters" : "More filters"}</button>
            {loading && <span className="sub">One request per year, spaced out — a cold multi-year search can take a little while.</span>}
          </div>
          {more && (
            <>
              <div className="fec-field">
                <label htmlFor="ms-to">Recipient is a</label>
                <select id="ms-to" value={f.toType} onChange={set("toType")}>
                  <option value="both">Candidate or PAC</option><option value="candidate">Candidate</option><option value="pac">PAC</option>
                </select>
              </div>
              <div className="fec-field wide">
                <label>Money from</label>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", minHeight: 36, alignItems: "center" }}>
                  {[["fromIndividual", "Individuals"], ["fromOrg", "Businesses / organizations"], ["fromPac", "PACs"], ["fromCandidate", "Candidates"]].map(([k, l]) => (
                    <label key={k} className="fec-check"><input type="checkbox" checked={from[k]} onChange={(e) => setFrom((p) => ({ ...p, [k]: e.target.checked }))} /> {l}</label>
                  ))}
                </div>
              </div>
              <div className="fec-field full">
                <label>Limit to these reports</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(meta?.reportTypes || []).map((rt) => (
                    <button key={rt.id} className="fec-chip" aria-pressed={reportTypes.includes(rt.id)}
                      onClick={() => setReportTypes((p) => (p.includes(rt.id) ? p.filter((x) => x !== rt.id) : [...p, rt.id]))}
                      style={reportTypes.includes(rt.id) ? { borderColor: "var(--brass)", color: "var(--brass)" } : undefined}>{rt.label}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="fec-error" role="alert">{error}</div>}
      {data && (
        <>
          <div className="tx-kpis">
            <div className="tx-kpi"><span>{isExp ? "Total spent" : "Total given"}</span><b>{fmtUSD(data.totalAmount)}</b></div>
            <div className="tx-kpi"><span>Transactions</span><b>{fmtNum(data.count)}</b>{data.capped && <small>showing the largest {fmtNum(data.rows.length)}</small>}</div>
            {data.perYear.map((y) => (
              <div className="tx-kpi" key={y.year}><span>Report year {y.year}</span><b>{y.error ? "—" : fmtUSDshort(y.total)}</b>
                <small>{y.error ? "failed" : `${fmtNum(y.count)} rows`}</small></div>
            ))}
          </div>
          {data.note && <div className="tx-note warn">{data.note}</div>}
          {data.truncated && (
            <div className="fec-error" role="status">
              At least one year came back with exactly 500 rows. TREF stops a search at 500 without saying so, so these totals are incomplete —
              narrow it with a report type, an amount, or a ZIP. For one candidate’s complete donor list use Candidate donors, which reads the filed reports instead.
            </div>
          )}
          {data.count === 0 && <div className="fec-empty">No transactions match. Try fewer filters, another report year, or leave “Match anywhere in a name” on.</div>}
          {data.count > 0 && (
            <>
              <div className="tx-cols">
                {isExp ? (
                  <>
                    <Rank title="Biggest spenders" items={data.top.spenders} onPick={(it) => onOpenEntity(it.name.split(",")[0])} />
                    <Rank title="Top vendors" items={data.top.vendors} color="var(--olive)" />
                    <Rank title="By purpose" items={data.top.purposes} color="var(--muted)" />
                  </>
                ) : (
                  <>
                    <Rank title="Top contributors" items={data.top.contributors} />
                    <Rank title="Top recipients" items={data.top.recipients} color="var(--olive)" onPick={(it) => onOpenEntity(it.name.split(",")[0])} />
                    <Rank title="By employer" items={data.top.employers} color="var(--muted)" />
                  </>
                )}
              </div>
              <div className="fec-status">
                <span>Largest first{colIdx(/^adj$/i) >= 0 ? " · “Adj” = Y marks an adjustment to an earlier report" : ""}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="fec-btn ghost" onClick={() => run(true)} disabled={loading} title="Re-query the open report years on TREF">↺ Refresh</button>
                  <button className="fec-btn ghost" onClick={() => downloadCSV(`tn_${kind}_${data.years.join("-")}.csv`, data.headers, data.rows)}>Export CSV ({fmtNum(data.rows.length)})</button>
                </span>
              </div>
              <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
                <div className="fec-table-wrap">
                  <table className="fec-table">
                    <thead><tr>{keep.map((i) => <th key={i} className={/^amount$/i.test(data.headers[i]) ? "amt" : undefined}>{data.headers[i]}</th>)}</tr></thead>
                    <tbody>
                      {data.rows.slice(0, shown).map((r, ri) => (
                        <tr key={ri}>{keep.map((i) => <td key={i} className={/^amount$/i.test(data.headers[i]) ? "amt" : undefined}>{r[i]}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {shown < data.rows.length && (
                <div className="fec-pager"><button onClick={() => setShown((s) => s + 200)}>Show 200 more</button>
                  <span className="fec-tag">{fmtNum(Math.min(shown, data.rows.length))} of {fmtNum(data.rows.length)}</span></div>
              )}
            </>
          )}
        </>
      )}
      {!data && !error && !loading && (
        <div className="fec-empty">Pick the report years, add at least one filter, and search. Example: contributions from ZIP 37660 over $1,000.</div>
      )}
    </>
  );
}

// =============================================================================================
//  Filings — the report search
// =============================================================================================
function Filings({ meta, onOpenEntity }) {
  const nowY = new Date().getFullYear();
  const [f, setF] = useState({ reportYear: String(nowY), name: "", for: "both", office: "", district: "", party: "", electionYear: "" });
  const [reportTypes, setReportTypes] = useState([]);
  const districts = useDistricts(f.office);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value, ...(k === "office" ? { district: "" } : {}) }));
  const run = async (refresh = false) => {
    setLoading(true); setError(null);
    try { setData(await getJSON(`/api/tn/explore/reports?${qsOf({ ...f, reportTypes: reportTypes.join(","), ...(refresh ? { _refresh: "1" } : {}) })}`)); }
    catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  };
  const yearOpts = (meta?.reportYears?.length ? meta.reportYears : Array.from({ length: 12 }, (_, i) => String(nowY - i)));
  return (
    <>
      <p className="tx-lede">
        Find <b>filings</b> rather than filers: every report of a given type and year, narrowed by office, district or party. Useful right after a
        deadline — pick “3rd Quarter” and “House of Representatives” to see who has filed.
      </p>
      <div className="tx-panel">
        <div className="tx-form">
          <div className="fec-field">
            <label htmlFor="fl-year">Report year</label>
            <select id="fl-year" value={f.reportYear} onChange={set("reportYear")}>{yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </div>
          <div className="fec-field">
            <label htmlFor="fl-for">Filed by</label>
            <select id="fl-for" value={f.for} onChange={set("for")}>
              <option value="both">Candidates and PACs</option><option value="candidate">Candidates</option><option value="pac">PACs</option>
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="fl-name">Name</label>
            <input id="fl-name" value={f.name} onChange={set("name")} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Last name or PAC name" />
          </div>
          <div className="fec-field">
            <label htmlFor="fl-office">Office</label>
            <select id="fl-office" value={f.office} onChange={set("office")}>
              <option value="">Any office</option>{(meta?.offices || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="fl-district">District</label>
            <select id="fl-district" value={f.district} onChange={set("district")} disabled={!districts.length}>
              <option value="">{f.office ? (districts.length ? "Any district" : "No districts") : "Pick an office first"}</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="fl-party">Party</label>
            <select id="fl-party" value={f.party} onChange={set("party")}>
              <option value="">Any party</option>{(meta?.parties || []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="fl-ey">Election year</label>
            <select id="fl-ey" value={f.electionYear} onChange={set("electionYear")}>
              <option value="">Any election</option>{(meta?.years || []).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
          </div>
          <div className="fec-field full">
            <label>Report type</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(meta?.reportTypes || []).map((rt) => (
                <button key={rt.id} className="fec-chip" aria-pressed={reportTypes.includes(rt.id)}
                  onClick={() => setReportTypes((p) => (p.includes(rt.id) ? p.filter((x) => x !== rt.id) : [...p, rt.id]))}
                  style={reportTypes.includes(rt.id) ? { borderColor: "var(--brass)", color: "var(--brass)" } : undefined}>{rt.label}</button>
              ))}
            </div>
          </div>
          <div className="full" style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <button className="fec-btn" onClick={() => run()} disabled={loading}>{loading ? "Searching…" : "Find filings"}</button>
            {loading && <span className="sub">Reading result pages from TREF…</span>}
          </div>
        </div>
      </div>
      {error && <div className="fec-error" role="alert">{error}</div>}
      {data && (
        <>
          <div className="fec-status">
            <span>{fmtNum(data.count)} filing{data.count === 1 ? "" : "s"} · report year {data.reportYear}
              {data.capped ? ` · first ${fmtNum(data.rows.length)} shown — narrow the search to see the rest` : ""}
              {data.cachedAt ? ` · saved ${timeAgo(data.cachedAt)}` : ""}</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="fec-btn ghost" onClick={() => run(true)} disabled={loading}>↺ Refresh</button>
              <button className="fec-btn ghost" disabled={!data.rows.length}
                onClick={() => downloadCSV(`tn_filings_${data.reportYear}.csv`, ["report", "name", "contact", "party", "report_id"], data.rows.map((r) => [r.reportName, r.name, r.contact, r.party, r.reportId]))}>
                Export CSV ({data.rows.length})</button>
            </span>
          </div>
          {data.note && <div className="tx-note warn">{data.note}</div>}
          {data.count === 0 && <div className="fec-empty">No filings match those filters for {data.reportYear}.</div>}
          {data.rows.length > 0 && (
            <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
              <div className="fec-table-wrap">
                <table className="fec-table">
                  <thead><tr><th>Report</th><th>Filed by</th><th>Party</th><th>Contact</th><th aria-label="Links" /></tr></thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={`${r.reportId}-${i}`}>
                        <td>{r.reportName}</td>
                        <td><button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 600 }} onClick={() => onOpenEntity(r.name.split(",")[0])}>{r.name}</button></td>
                        <td><PartyPill party={r.party} /></td>
                        <td className="sub">{r.contact.replace(/\s*\|\s*/g, " · ")}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {r.reportId && <a className="fec-extlink" target="_blank" rel="noopener noreferrer"
                            href={`https://apps.tn.gov/tncamp/search/pub/report_full.htm?reportId=${encodeURIComponent(r.reportId)}`}>Report on TREF ↗</a>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// =============================================================================================
//  Federal races — FEC totals for every Tennessee congressional candidate
// =============================================================================================
function FederalRaces({ onOpenRace }) {
  const nowY = new Date().getFullYear();
  const cur = nowY % 2 ? nowY + 1 : nowY;
  const [cycle, setCycle] = useState(String(cur));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [fundedOnly, setFundedOnly] = useState(true);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    getJSON(`/api/tn/federal/races?cycle=${cycle}`).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [cycle]);
  return (
    <>
      <p className="tx-lede">
        Every Tennessee U.S. Senate and House race for the cycle on one page, from the FEC’s candidate totals. Open a race to drill into
        donors, money flows and patterns on the Money race tab.
      </p>
      <div className="fec-status">
        <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select className="fec-modelsel" value={cycle} onChange={(e) => setCycle(e.target.value)} aria-label="Election cycle" style={{ fontSize: 14, padding: "6px 8px" }}>
            {Array.from({ length: 8 }, (_, i) => String(cur - i * 2)).map((y) => <option key={y} value={y}>{y} cycle</option>)}
          </select>
          <label className="fec-check"><input type="checkbox" checked={fundedOnly} onChange={(e) => setFundedOnly(e.target.checked)} /> Only candidates who raised money</label>
        </span>
        {data && <span>{data.candidateCount} candidates · {fmtUSDshort(data.totals.receipts)} raised · {fmtUSDshort(data.totals.cash)} on hand</span>}
      </div>
      {error && <div className="fec-error" role="alert">{error}</div>}
      {!data && !error && <div className="fec-empty"><span className="fec-spin">Loading Tennessee races</span></div>}
      {data && (
        <div className="tx-cols">
          {data.races.map((r) => {
            const cands = r.candidates.filter((c) => !fundedOnly || c.receipts > 0);
            const max = Math.max(...r.candidates.map((c) => c.receipts), 1);
            return (
              <div className="tx-race" key={r.key}>
                <h4>
                  <button className="tx-linkbtn" style={{ color: "var(--bone)", fontFamily: "inherit", fontWeight: 600 }}
                    onClick={() => onOpenRace({ office: r.office, district: r.district, cycle: Number(cycle) })}
                    title="Open this race on the Money race tab">{r.label} ▸</button>
                  <small>{fmtUSDshort(r.receipts)} raised</small>
                </h4>
                {cands.length === 0 && <div className="sub">No candidate has reported receipts.</div>}
                {cands.slice(0, 6).map((c) => (
                  <div className="tx-cand" key={c.id} style={{ "--pc": partyColor(c.party) }}>
                    <span>{c.name}{c.incumbent === "Incumbent" && <span className="sub"> · incumbent</span>}</span>
                    <span style={{ fontFamily: "var(--font-num)" }}>{fmtUSDshort(c.receipts)}</span>
                    <span className="sub">{c.party || "—"}</span>
                    <span className="sub" style={{ textAlign: "right" }}>{fmtUSDshort(c.cash)} on hand</span>
                    <span className="meter"><i style={{ width: `${Math.max(1, (c.receipts / max) * 100)}%` }} /></span>
                  </div>
                ))}
                {cands.length > 6 && <div className="tx-note">+ {cands.length - 6} more</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// =============================================================================================
//  Federal dollars — USAspending.gov
// =============================================================================================
const AWARD_TABS = [["", "Everything"], ["contracts", "Contracts"], ["grants", "Grants"], ["direct", "Direct payments"], ["loans", "Loans"], ["other", "Other"]];
function FederalDollars({ meta }) {
  const fyNow = (() => { const d = new Date(); return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); })();
  // default to the last full fiscal year — the one in progress only has a few weeks of awards reported
  const [fy, setFy] = useState(String(fyNow - 1));
  const [group, setGroup] = useState("");
  const [layer, setLayer] = useState("county");
  const [place, setPlace] = useState(null); // { type: "county" | "district", code, name }
  const [q, setQ] = useState(""); const [qLive, setQLive] = useState("");
  const [geo, setGeo] = useState(null);
  const [sum, setSum] = useState(null);
  const [awards, setAwards] = useState(null);
  const [awardGroup, setAwardGroup] = useState("grants");
  const [awardPage, setAwardPage] = useState(1);
  const [error, setError] = useState(null);
  const [perCapita, setPerCapita] = useState(false);

  const placeQs = place ? { [place.type]: place.code } : {};
  useEffect(() => {
    let live = true; setGeo(null); setError(null);
    getJSON(`/api/tn/federal/spending/geo?${qsOf({ fy, group, layer })}`).then((d) => { if (live) setGeo(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [fy, group, layer]);
  useEffect(() => {
    let live = true; setSum(null);
    getJSON(`/api/tn/federal/spending/summary?${qsOf({ fy, group, q: qLive, ...placeQs })}`).then((d) => { if (live) setSum(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line
  }, [fy, group, qLive, place?.code, place?.type]);
  const effAwardGroup = group || awardGroup;
  useEffect(() => {
    let live = true; setAwards(null);
    getJSON(`/api/tn/federal/spending/awards?${qsOf({ fy, group: effAwardGroup, q: qLive, page: awardPage, ...placeQs })}`).then((d) => { if (live) setAwards(d); }).catch((e) => { if (live) setAwards({ error: e.message }); });
    return () => { live = false; };
    // eslint-disable-next-line
  }, [fy, effAwardGroup, qLive, awardPage, place?.code, place?.type]);
  useEffect(() => { setAwardPage(1); }, [fy, effAwardGroup, qLive, place?.code]);

  const geoRows = useMemo(() => {
    const rows = [...(geo?.results || [])];
    if (perCapita) rows.sort((a, b) => (b.perCapita || 0) - (a.perCapita || 0));
    return rows;
  }, [geo, perCapita]);
  const geoMax = Math.max(...geoRows.map((r) => (perCapita ? r.perCapita || 0 : r.amount)), 1);
  const scopeLabel = place ? place.name : "Tennessee";
  const counts = sum?.counts || null;

  return (
    <>
      <p className="tx-lede">
        Where federal money lands in Tennessee and who receives it — contracts, grants, loans and direct payments from USAspending.gov, by
        county or congressional district. Amounts are by <b>place of performance</b> for the federal fiscal year (October–September).
      </p>
      <div className="tx-panel">
        <div className="tx-form">
          <div className="fec-field">
            <label htmlFor="fd-fy">Fiscal year</label>
            <select id="fd-fy" value={fy} onChange={(e) => setFy(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => String(fyNow - i)).map((y, i) => <option key={y} value={y}>FY {y}{i === 0 ? " (in progress)" : ""}</option>)}
            </select>
          </div>
          <div className="fec-field" style={{ gridColumn: "span 3" }}>
            <label>Award type</label>
            <div className="tx-seg" role="group" aria-label="Award type" style={{ flexWrap: "wrap" }}>
              {AWARD_TABS.map(([v, l]) => <button key={v || "all"} aria-pressed={group === v} onClick={() => setGroup(v)}>{l}</button>)}
            </div>
          </div>
          <div className="fec-field full" style={{ maxWidth: 640 }}>
            <label htmlFor="fd-q">Recipient name contains</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="fd-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQLive(q.trim())} placeholder="e.g. Eastman, East Tennessee State University" />
              <button className="fec-btn ghost" onClick={() => setQLive(q.trim())}>Apply</button>
              {qLive && <button className="fec-btn ghost" onClick={() => { setQ(""); setQLive(""); }}>Clear</button>}
            </div>
          </div>
        </div>
      </div>
      {error && <div className="fec-error" role="alert">{error}</div>}

      <div className="tx-cols" style={{ gridTemplateColumns: "minmax(280px, 380px) 1fr" }}>
        <div className="tx-panel" style={{ alignSelf: "start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <div className="tx-seg" role="group" aria-label="Geography">
              <button aria-pressed={layer === "county"} onClick={() => { setLayer("county"); setPlace(null); }}>Counties</button>
              <button aria-pressed={layer === "district"} onClick={() => { setLayer("district"); setPlace(null); }}>Districts</button>
            </div>
            <label className="fec-check"><input type="checkbox" checked={perCapita} onChange={(e) => setPerCapita(e.target.checked)} /> Per resident</label>
          </div>
          {!geo && !error && <span className="fec-spin">Loading</span>}
          {geo && (
            <>
              <div className="sub" style={{ marginBottom: 6 }}>
                {fmtUSDshort(geo.total)} tied to a specific {layer}{geo.stale ? " · saved copy" : ""}. Select one to focus the breakdown.
              </div>
              <ol className="tx-rank" style={{ maxHeight: 620, overflowY: "auto", paddingRight: 6 }}>
                {place && <li><span className="nm"><button onClick={() => setPlace(null)}>← All of Tennessee</button></span><span /></li>}
                {geoRows.map((r) => {
                  const on = place?.code === r.code && place?.type === layer;
                  const val = perCapita ? r.perCapita || 0 : r.amount;
                  return (
                    <li key={r.code} style={on ? { "--bar": "var(--olive)" } : undefined}>
                      <span className="nm"><button style={on ? { color: "var(--olive)", fontWeight: 600 } : undefined}
                        onClick={() => setPlace(on ? null : { type: layer, code: r.code, name: r.name })}>{r.name}</button></span>
                      <span className="amt">{perCapita ? `${fmtUSD(val)}` : fmtUSDshort(val)}</span>
                      <span className="meter"><i style={{ width: `${Math.max(1, (val / geoMax) * 100)}%` }} /></span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="tx-kpis" style={{ marginTop: 0 }}>
            <div className="tx-kpi"><span>Showing</span><b style={{ fontFamily: "var(--font-head)", fontWeight: 600 }}>{scopeLabel}</b><small>FY {fy}{qLive ? ` · “${qLive}”` : ""}</small></div>
            {[["contracts", "Contracts"], ["grants", "Grants"], ["direct_payments", "Direct payments"], ["loans", "Loans"]].map(([k, l]) => (
              <div className="tx-kpi" key={k}><span>{l}</span><b>{!sum ? "…" : counts ? fmtNum(counts[k] ?? 0) : "—"}</b><small>awards</small></div>
            ))}
          </div>
          <div className="tx-cols">
            <Rank title="Top recipients" items={Array.isArray(sum?.recipients) ? sum.recipients.slice(0, 15) : []}
              onPick={(it) => { if (!/^multiple recipients$/i.test(it.name)) { setQ(it.name); setQLive(it.name); } }} />
            <Rank title="Paying agencies" items={Array.isArray(sum?.agencies) ? sum.agencies.slice(0, 12) : []} color="var(--olive)" />
            <Rank title="Programs" items={Array.isArray(sum?.programs) ? sum.programs.slice(0, 12).map((p) => ({ ...p, name: p.code ? `${p.name} (${p.code})` : p.name })) : []} color="var(--muted)" />
          </div>
          {sum?.note && <div className="tx-note warn">{sum.note}</div>}
          {sum && !sum.partial && !sum.recipients?.length && !sum.agencies?.length && <div className="fec-empty">No federal awards recorded for this selection.</div>}

          <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
              <h3 className="tx-h" style={{ margin: 0 }}>Largest awards</h3>
              {!group && (
                <div className="tx-seg" role="group" aria-label="Award list type">
                  {AWARD_TABS.slice(1).map(([v, l]) => <button key={v} aria-pressed={awardGroup === v} onClick={() => setAwardGroup(v)}>{l}</button>)}
                </div>
              )}
            </div>
            {!awards && <div style={{ padding: "0 16px 14px" }}><span className="fec-spin">Loading awards</span></div>}
            {awards?.error && <div className="fec-error" style={{ margin: "0 16px 14px" }}>{awards.error}</div>}
            {awards?.awards && awards.awards.length === 0 && <div className="sub" style={{ padding: "0 16px 14px" }}>No awards of this type for the selection.</div>}
            {awards?.awards?.length > 0 && (
              <div className="fec-table-wrap">
                <table className="fec-table">
                  <thead><tr><th>Recipient</th><th className="amt">{effAwardGroup === "loans" ? "Loan value" : "Amount"}</th><th>Agency</th><th>What for</th><th>Dates</th></tr></thead>
                  <tbody>
                    {awards.awards.map((a, i) => (
                      <tr key={`${a.id}-${i}`}>
                        <td><b style={{ fontWeight: 600 }}>{a.recipient || "—"}</b>
                          <div className="sub">{a.url ? <a className="fec-extlink" href={a.url} target="_blank" rel="noopener noreferrer">{a.id} ↗</a> : a.id}</div></td>
                        <td className="amt">{fmtUSD(a.amount)}</td>
                        <td>{a.agency}<div className="sub">{a.subAgency !== a.agency ? a.subAgency : ""}</div></td>
                        <td style={{ maxWidth: 360 }}><span title={a.description}>{a.description.length > 150 ? `${a.description.slice(0, 150)}…` : a.description || "—"}</span></td>
                        <td className="sub" style={{ whiteSpace: "nowrap" }}>{a.start || "—"}{a.end ? <><br />to {a.end}</> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {awards?.awards && (awards.hasNext || awardPage > 1) && (
              <div className="fec-pager" style={{ padding: "0 16px 14px" }}>
                <button onClick={() => setAwardPage((p) => Math.max(1, p - 1))} disabled={awardPage <= 1}>◂ Prev</button>
                <span className="fec-tag">page {awardPage}</span>
                <button onClick={() => setAwardPage((p) => p + 1)} disabled={!awards.hasNext}>Next ▸</button>
                <button className="fec-btn ghost" style={{ marginLeft: "auto" }}
                  onClick={() => downloadCSV(`tn_federal_awards_fy${fy}_${effAwardGroup}.csv`, ["recipient", "amount", "agency", "sub_agency", "description", "start", "end", "award_id", "url"],
                    awards.awards.map((a) => [a.recipient, a.amount, a.agency, a.subAgency, a.description, a.start, a.end, a.id, a.url]))}>Export CSV</button>
              </div>
            )}
          </div>
          <div className="tx-note">
            Source: USAspending.gov. “Multiple recipients” rows are aggregated payments to individuals (Social Security, VA benefits and similar).
            Statewide programs the state administers from Nashville (Medicaid and other grants to state departments) are recorded in Davidson County,
            which is why it dwarfs the rest.
          </div>
        </div>
      </div>
    </>
  );
}

// =============================================================================================
//  Candidate donors — one name in, every donor out (federal + state)
// =============================================================================================
const post = (url, body) => getJSON(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const officeName = (o) => (o === "S" ? "U.S. Senate" : o === "H" ? "U.S. House" : o === "P" ? "President" : o);

function CandidateDonors({ onOpenDonor }) {
  const [q, setQ] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState(null);
  const [selFed, setSelFed] = useState({});     // committeeId -> bool
  const [selState, setSelState] = useState({}); // tnId -> bool
  const [cycles, setCycles] = useState([]);
  const [who, setWho] = useState("all"); // all | people | orgs
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [job, setJob] = useState(null);
  const [filter, setFilter] = useState("");
  const [src, setSrc] = useState("all");
  const [page, setPage] = useState(0);
  const PER = 100;
  const pollRef = useRef(null);
  const lastDone = useRef(0);
  useEffect(() => () => clearTimeout(pollRef.current), []);

  const allCommittees = useMemo(() => (found?.federal || []).flatMap((c) => c.committees.map((pc) => ({ ...pc, cand: c }))), [found]);
  const cycleOpts = useMemo(() => {
    const set = new Set();
    for (const c of found?.federal || []) if (c.committees.some((pc) => selFed[pc.id])) for (const cy of c.cycles) set.add(cy);
    return [...set].sort().reverse().slice(0, 8);
  }, [found, selFed]);

  const find = async () => {
    if (q.trim().length < 2) return;
    setFinding(true); setError(null); setData(null); setFound(null);
    try {
      const d = await getJSON(`/api/tn/candidate/find?q=${encodeURIComponent(q.trim())}`);
      setFound(d);
      // preselect: the most recently active federal candidacy and the most recent state account
      const f = {}; const top = d.federal[0];
      if (top) for (const pc of top.committees) f[pc.id] = true;
      setSelFed(f);
      setSelState(d.state[0] ? { [d.state[0].tnId]: true } : {});
      setCycles(top ? top.cycles.slice(0, 2) : []);
    } catch (e) { setError(e.message); }
    finally { setFinding(false); }
  };

  const body = () => {
    const committees = Object.keys(selFed).filter((k) => selFed[k]);
    const state = (found?.state || []).filter((s) => selState[s.tnId]).map((s) => ({ tnId: s.tnId, name: s.name }));
    return { committees, cycles: cycles.filter((c) => cycleOpts.includes(c)), state };
  };

  const loadDonors = async (quiet = false) => {
    if (!quiet) { setLoading(true); setPage(0); }
    setError(null);
    try { const d = await post("/api/tn/candidate/donors", body()); setData(d); return d; }
    catch (e) { setError(e.message); return null; }
    finally { if (!quiet) setLoading(false); }
  };

  const poll = async () => {
    try {
      const j = await getJSON("/api/tn/candidate/pull");
      setJob(j);
      const done = (j.items || []).reduce((a, i) => a + (i.pulled || 0), 0);
      if (done - lastDone.current >= 1000 || !j.running) { lastDone.current = done; loadDonors(true); }
      if (j.running) pollRef.current = setTimeout(poll, 2500);
    } catch { /* next action retries */ }
  };
  const startPull = async (full) => {
    const b = body();
    if (!b.committees.length || !b.cycles.length) return;
    try { await post("/api/tn/candidate/pull", { committees: b.committees, cycles: b.cycles, full }); lastDone.current = 0; clearTimeout(pollRef.current); poll(); }
    catch (e) { setError(e.message); }
  };

  const show = async () => {
    const d = await loadDonors();
    // first look at a committee: fetch its largest itemized receipts in the background
    if (d?.coverage?.some((c) => !c.complete && c.available == null)) startPull(false);
  };

  const rows = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const isPerson = (d) => (d.type ? /^IND/i.test(d.type) : d.name.includes(","));
    return (data?.donors || []).filter((d) =>
      (src === "all" || (src === "federal" && d.federal) || (src === "state" && d.stateAmt) || (src === "both" && d.federal && d.stateAmt)) &&
      (who === "all" || (who === "people") === isPerson(d)) &&
      (!f || `${d.name} ${d.employer} ${d.occupation} ${d.city} ${d.st}`.toUpperCase().includes(f)));
  }, [data, filter, src, who]);
  useEffect(() => { setPage(0); }, [filter, src, who]);
  const hasFed = Object.values(selFed).some(Boolean), hasState = Object.values(selState).some(Boolean);
  const incomplete = (data?.coverage || []).filter((c) => !c.complete);
  const remaining = incomplete.reduce((a, c) => a + Math.max(0, (c.available || 0) - c.stored), 0);
  const exportCsv = () => downloadCSV(`donors_${(found?.q || "candidate").replace(/\W+/g, "_")}.csv`,
    ["donor", "city", "state", "employer", "occupation", "type", "federal_total", "state_total", "total", "gifts", "first_gift", "last_gift"],
    rows.map((d) => [d.name, d.city, d.st, d.employer, d.occupation, d.type, d.federal, d.stateAmt, d.total, d.count, d.firstDate, d.lastDate]));

  return (
    <>
      <p className="tx-lede">
        Type a Tennessee candidate’s name to get <b>one donor list</b> covering their federal committees (FEC) and their state campaign
        account (TREF). Someone like a sitting senator running for governor has both — this puts them side by side.
      </p>
      <div className="tx-panel">
        <div style={{ display: "flex", gap: 8, maxWidth: 640 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()} aria-label="Candidate name"
            placeholder="Candidate name — e.g. Marsha Blackburn"
            style={{ flex: 1, background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "8px 12px", fontSize: 14 }} />
          <button className="fec-btn" onClick={find} disabled={finding || q.trim().length < 2}>{finding ? "Looking…" : "Find candidate"}</button>
        </div>

        {found && !found.federal.length && !found.state.length && (
          <div className="tx-note warn" style={{ marginTop: 12 }}>
            No Tennessee candidate matches “{found.q}”. Try the last name alone. {found.notes.join(" ")}
          </div>
        )}
        {found && (found.federal.length > 0 || found.state.length > 0) && (
          <div className="tx-cols" style={{ marginTop: 14 }}>
            <div style={{ minWidth: 0 }}>
              <h3 className="tx-h">Federal committees <span className="sub" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>· FEC</span></h3>
              {!found.federal.length && <div className="sub">No federal candidacy on file in Tennessee.</div>}
              {found.federal.map((c) => (
                <div key={c.candId} style={{ marginBottom: 10, paddingLeft: 9, borderLeft: `3px solid ${partyColor(c.party)}` }}>
                  <div><b style={{ fontWeight: 600 }}>{c.name}</b> <span className="sub">· {officeName(c.office)}{c.district && c.district !== "00" ? ` TN-${c.district}` : ""} · {c.cycles[c.cycles.length - 1]}–{c.cycles[0]}</span></div>
                  {!c.committees.length && <div className="sub">No principal committee registered.</div>}
                  {c.committees.map((pc) => (
                    <label key={pc.id} className="fec-check" style={{ marginTop: 4 }}>
                      <input type="checkbox" checked={!!selFed[pc.id]} onChange={(e) => setSelFed((p) => ({ ...p, [pc.id]: e.target.checked }))} />
                      <span style={{ color: "var(--bone)" }}>{pc.name}</span> <span className="sub">{pc.id}</span>
                    </label>
                  ))}
                </div>
              ))}
              {hasFed && cycleOpts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="sub" style={{ marginBottom: 5 }}>Two-year periods to include</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {cycleOpts.map((cy) => (
                      <button key={cy} className="fec-chip" aria-pressed={cycles.includes(cy)}
                        onClick={() => setCycles((p) => (p.includes(cy) ? p.filter((x) => x !== cy) : [...p, cy]))}
                        style={cycles.includes(cy) ? { borderColor: "var(--brass)", color: "var(--brass)" } : undefined}>{Number(cy) - 1}–{cy}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 className="tx-h">State accounts <span className="sub" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>· Tennessee Registry of Election Finance</span></h3>
              {!found.state.length && <div className="sub">No state campaign account found under that name.</div>}
              {found.state.map((s) => (
                <label key={s.tnId} className="fec-check" style={{ marginBottom: 6, alignItems: "flex-start" }}>
                  <input type="checkbox" style={{ marginTop: 4 }} checked={!!selState[s.tnId]} onChange={(e) => setSelState((p) => ({ ...p, [s.tnId]: e.target.checked }))} />
                  <span>
                    <span style={{ color: "var(--bone)" }}>{s.name}</span>{" "}
                    <span className="sub">{[s.kind === "pac" ? "PAC" : s.office || "Candidate", s.district && `district ${s.district}`, s.party, s.years.join(", ")].filter(Boolean).join(" · ")}</span>
                  </span>
                </label>
              ))}
              {hasState && <div className="sub" style={{ marginTop: 6 }}>Reads every report the account has filed; a first look takes about a second per report.</div>}
            </div>
            <div className="full" style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="fec-btn" onClick={show} disabled={loading || (!hasFed && !hasState) || (hasFed && !hasState && !cycles.length)}>
                {loading ? "Gathering donors…" : "Show donors"}</button>
              {found.notes.length > 0 && <span className="tx-note warn" style={{ margin: 0 }}>{found.notes.join(" ")}</span>}
            </div>
          </div>
        )}
      </div>

      {error && <div className="fec-error" role="alert">{error}</div>}

      {data && (
        <>
          <div className="tx-kpis">
            <div className="tx-kpi"><span>Donors</span><b>{fmtNum(data.totals.donors)}</b><small>{fmtNum(data.totals.gifts)} itemized gifts</small></div>
            <div className="tx-kpi"><span>Federal, itemized</span><b>{fmtUSD(data.totals.federal)}</b><small>FEC Schedule A</small></div>
            <div className="tx-kpi"><span>State, itemized</span><b>{fmtUSD(data.totals.state)}</b><small>TREF reports</small></div>
            <div className="tx-kpi"><span>Gave to both</span><b>{fmtNum(data.totals.both)}</b><small>same name and state</small></div>
          </div>

          {(data.coverage.length > 0 || data.stateAccounts.length > 0) && (
            <div className="tx-panel">
              <h3>What this list covers</h3>
              {data.coverage.map((c) => {
                const live = job?.running && job.items?.find((i) => i.committee === c.committee && i.cycle === c.cycle);
                const stored = Math.max(c.stored, live?.pulled || 0), avail = live?.available ?? c.available;
                return (
                  <div key={`${c.committee}-${c.cycle}`} style={{ fontSize: 13, padding: "4px 0" }}>
                    <b style={{ fontWeight: 600 }}>{allCommittees.find((x) => x.id === c.committee)?.name || c.committee}</b> · {Number(c.cycle) - 1}–{c.cycle}:{" "}
                    {c.complete ? <span style={{ color: "var(--olive)" }}>all {fmtNum(c.stored)} itemized rows stored</span>
                      : avail != null ? <span>{fmtNum(stored)} of {fmtNum(avail)} itemized rows stored, largest first</span>
                      : <span className="sub">{fmtNum(stored)} rows stored so far — checking the FEC for the rest</span>}
                    {live && !live.done && avail ? <div className="tx-progress" style={{ maxWidth: 360 }}><i style={{ width: `${Math.min(100, (stored / avail) * 100)}%` }} /></div> : null}
                  </div>
                );
              })}
              {data.stateAccounts.map((a) => (
                <div key={a.tnId} style={{ fontSize: 13, padding: "4px 0" }}>
                  <b style={{ fontWeight: 600 }}>{a.name}</b> · state account:{" "}
                  {a.error ? <span style={{ color: "var(--rose)" }}>failed — {a.error}</span> : (
                    <span>
                      <span style={a.partial ? undefined : { color: "var(--olive)" }}>{a.partial ? `${a.reportsRead} of ${a.reportsTotal} filed reports read` : `all ${a.reportsTotal} filed reports read`}</span>
                      {" · "}{fmtUSD(a.itemized)} itemized here{a.reportedReceipts ? `; the reports’ own receipt totals add up to ${fmtUSD(a.reportedReceipts)}` : ""}
                      {a.years.length > 0 && <span className="sub"> · {a.years.map((y) => `${y.year}: ${fmtNum(y.count)} gifts`).join(", ")}</span>}
                    </span>
                  )}
                  {a.partial && !a.error && <span className="sub"> — press Show donors again to read the rest.</span>}
                  {a.note && <div className="tx-note warn">{a.note}</div>}
                </div>
              ))}
              {job?.running && <div className="tx-note">{job.status || `Pulling ${job.current || ""} from the FEC — the list below updates as rows arrive.`}</div>}
              {job && !job.running && job.errors?.length > 0 && <div className="tx-note warn">{job.errors.join(" · ")}</div>}
              {!job?.running && incomplete.length > 0 && remaining > 0 && (
                <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="fec-btn ghost" onClick={() => startPull(true)}>Pull the remaining {fmtNum(remaining)} rows</button>
                  <span className="sub">About {fmtNum(Math.ceil(remaining / 100))} FEC requests (100 rows each; the key allows 1,000 an hour, and the pull waits out the limit). Runs in the background and is stored for good.</span>
                </div>
              )}
              <div className="tx-note">
                Itemized gifts only: federal donors appear once they pass $200 in a cycle, so small-dollar money is in the candidate’s totals but not here.
                {data.conduits.count > 0 && ` ${data.conduits.names.join(" / ")} pass-through lines (${fmtUSD(data.conduits.total)}) are left out — that money is listed under the people who gave it.`}
                {" "}Transfers from joint fundraising committees show as one line each; the people behind them are itemized on those committees’ own reports. Leadership PACs are separate committees and are not included.
              </div>
            </div>
          )}

          <div className="fec-status">
            <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, employer, city…" aria-label="Filter donors"
                style={{ background: "var(--panel)", color: "var(--bone)", border: "1px solid var(--line)", padding: "6px 10px", fontSize: 13, width: 260 }} />
              <div className="tx-seg" role="group" aria-label="Source">
                {[["all", "All"], ["federal", "Federal"], ["state", "State"], ["both", "Both"]].map(([v, l]) => <button key={v} aria-pressed={src === v} onClick={() => setSrc(v)}>{l}</button>)}
              </div>
              <div className="tx-seg" role="group" aria-label="Donor kind">
                {[["all", "Everyone"], ["people", "People"], ["orgs", "Committees and businesses"]].map(([v, l]) => <button key={v} aria-pressed={who === v} onClick={() => setWho(v)}>{l}</button>)}
              </div>
              <span>{fmtNum(rows.length)} donor{rows.length === 1 ? "" : "s"}</span>
            </span>
            <button className="fec-btn ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV ({fmtNum(rows.length)})</button>
          </div>
          {rows.length === 0 && <div className="fec-empty">{data.donors.length ? "No donor matches that filter." : job?.running ? "Rows are on their way from the FEC…" : "No itemized donors found for the selected accounts."}</div>}
          {rows.length > 0 && (
            <div className="tx-panel" style={{ padding: 0, overflow: "hidden" }}>
              <div className="fec-table-wrap">
                <table className="fec-table">
                  <thead><tr><th>Donor</th><th>Location</th><th>Employer / occupation</th><th className="amt">Federal</th><th className="amt">State</th><th className="amt">Total</th><th className="amt">Gifts</th><th>Last gift</th></tr></thead>
                  <tbody>
                    {rows.slice(page * PER, (page + 1) * PER).map((d) => (
                      <tr key={d.key}>
                        <td><button className="tx-linkbtn" style={{ color: "var(--bone)", fontWeight: 600 }} onClick={() => onOpenDonor?.(d.name)}
                          title="Open this donor’s full giving history on the Donors tab">{d.name}</button>
                          {d.type && !/^IND$/i.test(d.type) && <span className="fec-badge">{d.type}</span>}</td>
                        <td>{[d.city, d.st].filter(Boolean).join(", ") || "—"}</td>
                        <td>{d.employer || "—"}{d.occupation ? <div className="sub">{d.occupation}</div> : null}</td>
                        <td className="amt" style={d.federal ? undefined : { color: "var(--muted)" }}>{d.federal ? fmtUSD(d.federal) : "—"}</td>
                        <td className="amt" style={d.stateAmt ? undefined : { color: "var(--muted)" }}>{d.stateAmt ? fmtUSD(d.stateAmt) : "—"}</td>
                        <td className="amt"><b>{fmtUSD(d.total)}</b></td>
                        <td className="amt" style={{ color: "var(--bone)" }}>{d.count}</td>
                        <td className="sub" style={{ whiteSpace: "nowrap" }}>{d.lastDate || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {rows.length > PER && (
            <div className="fec-pager">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>◂ Prev</button>
              <span className="fec-tag">page {page + 1} / {Math.ceil(rows.length / PER)}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PER >= rows.length}>Next ▸</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// =============================================================================================
//  Hub
// =============================================================================================
export default function TennesseeHub({ registry, seed, onOpenEntity, onOpenRace, onOpenDonor }) {
  const [section, setSection] = useState("candidate");
  const [visited, setVisited] = useState({ registry: true, candidate: true });
  const meta = useMeta();
  const go = (s) => { setSection(s); setVisited((v) => (v[s] ? v : { ...v, [s]: true })); };
  // a drill-through (from Donors, or from a section here) lands on the Registry
  useEffect(() => { if (seed?.t) go("registry"); /* eslint-disable-next-line */ }, [seed?.t]);
  const open = (name) => { const n = String(name || "").trim(); if (n) onOpenEntity(n); };
  const show = (s) => ({ display: section === s ? undefined : "none" });
  return (
    <>
      <div className="tx-subnav" role="tablist" aria-label="Tennessee sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} onClick={() => go(id)}>{label}</button>
        ))}
      </div>
      {/* sections stay mounted once opened so a search isn't lost when you look at another one */}
      <div style={show("candidate")}><CandidateDonors onOpenDonor={onOpenDonor} /></div>
      <div style={show("registry")}>{registry}</div>
      {visited.directory && <div style={show("directory")}><Directory meta={meta} onOpenEntity={open} /></div>}
      {visited.money && <div style={show("money")}><MoneySearch meta={meta} onOpenEntity={open} /></div>}
      {visited.filings && <div style={show("filings")}><Filings meta={meta} onOpenEntity={open} /></div>}
      {visited.races && <div style={show("races")}><FederalRaces onOpenRace={onOpenRace} /></div>}
      {visited.dollars && <div style={show("dollars")}><FederalDollars meta={meta} /></div>}
    </>
  );
}
