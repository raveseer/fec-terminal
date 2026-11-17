// App stylesheet. Kept as a string (not a .css import) because the dossier print view embeds the
// same rules into its print document. Theme = CSS variables on :root; the legacy variable names
// (--ink, --panel, --bone, --brass, --olive …) are kept because ~500 inline styles reference them.
//   --ink    page background        --bone   primary text
//   --panel  surface                --muted  secondary text
//   --panel2 raised / hover surface --brass  primary accent (actions, amounts, selection)
//   --line   borders                --olive  secondary accent (links, AI, "ok")
// Fonts are bundled (see main.jsx) — no request to Google Fonts.
export const css = `
  :root {
    color-scheme: dark;
    --ink:#10161A; --panel:#172026; --panel2:#1E2A31; --panel3:#26353D; --line:#2E3D46; --line-soft:#222F37;
    --bone:#E7ECEE; --muted:#93A1A9; --sub:#93A1A9; --border:#2E3D46;
    --brass:#DDB548; --brass-hi:#EBC766; --brass-ink:#1B1403;
    --olive:#63BDB1; --rose:#E8776A; --danger:#E8776A; --warn:#E39A4E;
    --radius:8px; --radius-sm:5px;
    --font-ui:'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --font-num:'IBM Plex Mono', ui-monospace, Menlo, monospace;
    --font-head:'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif;
    --shadow:0 1px 2px rgb(0 0 0 / .4), 0 10px 28px rgb(0 0 0 / .28);
    --bar-h:54px;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      color-scheme: light;
      --ink:#F1F4F5; --panel:#FFFFFF; --panel2:#F0F3F5; --panel3:#E5EAED; --line:#C9D3D9; --line-soft:#E0E6EA;
      --bone:#141D23; --muted:#586872; --sub:#586872; --border:#C9D3D9;
      --brass:#7A5B00; --brass-hi:#93700A; --brass-ink:#FFFFFF;
      --olive:#136F68; --rose:#B33A2B; --danger:#B33A2B; --warn:#A85A0C;
      --shadow:0 1px 2px rgb(20 29 35 / .08), 0 10px 28px rgb(20 29 35 / .10);
    }
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --ink:#F1F4F5; --panel:#FFFFFF; --panel2:#F0F3F5; --panel3:#E5EAED; --line:#C9D3D9; --line-soft:#E0E6EA;
    --bone:#141D23; --muted:#586872; --sub:#586872; --border:#C9D3D9;
    --brass:#7A5B00; --brass-hi:#93700A; --brass-ink:#FFFFFF;
    --olive:#136F68; --rose:#B33A2B; --danger:#B33A2B; --warn:#A85A0C;
    --shadow:0 1px 2px rgb(20 29 35 / .08), 0 10px 28px rgb(20 29 35 / .10);
  }

  * { box-sizing: border-box; }
  body { margin:0; background:var(--ink); }
  .fec-root {
    min-height:100vh; background:var(--ink); color:var(--bone);
    font-family:var(--font-ui); font-size:14px; line-height:1.5;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  .fec-root ::selection { background:color-mix(in srgb, var(--brass) 35%, transparent); }
  .fec-root a { color:var(--olive); }
  .fec-root a.app-brand { color:var(--bone); }
  .fec-root button, .fec-root input, .fec-root select, .fec-root textarea { font-family:inherit; }
  .fec-root input, .fec-root select, .fec-root textarea { border-radius:var(--radius-sm); }
  .fec-root input::placeholder { color:var(--muted); opacity:.75; }
  .fec-root input[type="text"], .fec-root input[type="search"], .fec-root input[type="number"], .fec-root input:not([type]) { min-height:36px; }
  .fec-root :is(input, select, textarea):focus-visible, .fec-root button:focus-visible, .fec-root a:focus-visible {
    outline:2px solid var(--brass); outline-offset:1px;
  }
  .fec-root table { font-variant-numeric:tabular-nums; }
  .fec-wrap { max-width:1240px; margin:0 auto; padding:20px 24px 72px; }

  /* ---------- app bar ---------- */
  .app-bar { position:sticky; top:0; z-index:50; background:color-mix(in srgb, var(--panel) 92%, transparent);
    backdrop-filter:saturate(1.4) blur(10px); border-bottom:1px solid var(--line); }
  .app-bar-in { max-width:1240px; margin:0 auto; padding:0 24px; min-height:var(--bar-h);
    display:flex; align-items:center; gap:20px; }
  .app-brand { display:flex; align-items:center; gap:10px; flex-shrink:0; text-decoration:none; color:var(--bone); }
  .app-mark { width:26px; height:26px; flex-shrink:0; }
  .app-brand b { font-family:var(--font-head); font-weight:700; font-size:18px; letter-spacing:.01em; line-height:1; white-space:nowrap; }
  .app-brand small { display:block; font-size:11px; color:var(--muted); font-weight:400; margin-top:3px; white-space:nowrap; }
  .app-nav { display:flex; gap:2px; align-self:stretch; overflow-x:auto; scrollbar-width:none; flex:1; min-width:0; }
  .app-nav::-webkit-scrollbar { display:none; }
  .app-nav button { background:none; border:none; color:var(--muted); font-size:14px; font-weight:500; padding:0 13px; cursor:pointer;
    white-space:nowrap; position:relative; }
  .app-nav button:hover { color:var(--bone); }
  .app-nav button[aria-selected="true"] { color:var(--bone); font-weight:600; }
  .app-nav button[aria-selected="true"]::after { content:""; position:absolute; left:10px; right:10px; bottom:-1px; height:3px;
    background:var(--brass); border-radius:3px 3px 0 0; }
  .app-tools { display:flex; align-items:center; gap:8px; flex-shrink:0; }
  .status-pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); padding:4px 9px;
    border:1px solid var(--line); border-radius:999px; white-space:nowrap; }
  .icon-btn { background:none; border:1px solid var(--line); color:var(--muted); min-width:34px; height:34px; padding:0 9px;
    border-radius:var(--radius-sm); cursor:pointer; font-size:13px; display:inline-flex; align-items:center; justify-content:center; gap:5px; }
  .icon-btn:hover { color:var(--bone); border-color:var(--muted); background:var(--panel2); }
  .icon-btn.on { color:var(--brass); border-color:var(--brass); }
  .fec-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .status-pill .fec-dot { margin-right:0; }

  /* legacy header classes (still used by a few panels) */
  .fec-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
  .fec-eyebrow { color:var(--muted); font-size:12px; }
  .fec-title { font-family:var(--font-head); font-weight:700; font-size:28px; line-height:1.1; color:var(--bone); margin:4px 0; }
  .fec-title em { font-style:normal; }
  .fec-sub { color:var(--muted); max-width:60ch; }
  .fec-health { font-size:12px; color:var(--muted); text-align:right; line-height:1.8; }
  .fec-modelsel { background:var(--ink); color:var(--bone); border:1px solid var(--line); font:inherit; font-size:12px; padding:3px 6px; max-width:180px; }

  /* ---------- filter / section panels ---------- */
  .fec-controls {
    margin-top:16px; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
    padding:16px 18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:14px;
  }
  .fec-field label { display:block; font-size:12px; font-weight:500; color:var(--muted); margin-bottom:5px; }
  .fec-field select, .fec-field input {
    width:100%; background:var(--ink); color:var(--bone);
    border:1px solid var(--line); border-radius:var(--radius-sm); padding:8px 10px; font:inherit; font-size:14px; min-height:36px;
  }
  .fec-field select:hover, .fec-field input:hover { border-color:var(--muted); }
  .fec-field select:disabled { opacity:.4; }
  .fec-actions { grid-column:1 / -1; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }

  .fec-btn {
    background:var(--brass); color:var(--brass-ink); border:1px solid transparent; padding:8px 18px; border-radius:var(--radius-sm);
    font-family:var(--font-ui); font-weight:600; font-size:14px; cursor:pointer; line-height:1.3; white-space:nowrap;
  }
  .fec-btn:hover { background:var(--brass-hi); }
  .fec-btn:disabled { opacity:.45; cursor:default; }
  .fec-btn.ghost { background:transparent; border-color:var(--line); color:var(--bone); font-weight:500; font-size:13px; padding:6px 12px; }
  .fec-btn.ghost:hover { border-color:var(--brass); color:var(--brass); background:color-mix(in srgb, var(--brass) 8%, transparent); }
  .fec-btn.ghost:disabled:hover { border-color:var(--line); color:var(--bone); background:transparent; }
  .fec-btn.ghost.sm { padding:3px 9px; font-size:12px; }
  .fec-check { color:var(--muted); font-size:13px; display:flex; align-items:center; gap:7px; cursor:pointer; user-select:none; }
  .fec-check input { accent-color:var(--brass); min-height:0; }
  .fec-hint { color:var(--muted); font-size:12px; max-width:52ch; }

  /* in-panel tabs (TN money sub-tabs etc.) */
  .fec-tabs { margin-top:20px; display:flex; border-bottom:1px solid var(--line); overflow-x:auto; scrollbar-width:none; }
  .fec-tabs::-webkit-scrollbar { display:none; }
  .fec-tab { background:none; border:none; color:var(--muted); font:inherit; font-weight:500; font-size:14px; padding:8px 14px; cursor:pointer;
    border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap; flex-shrink:0; }
  .fec-tab:hover { color:var(--bone); }
  .fec-tab[aria-selected="true"] { color:var(--bone); font-weight:600; border-bottom-color:var(--brass); }

  .fec-status { margin-top:16px; color:var(--muted); display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:13px; align-items:center; }
  .fec-error { margin-top:16px; border:1px solid color-mix(in srgb, var(--rose) 55%, var(--line)); background:color-mix(in srgb, var(--rose) 10%, var(--panel));
    color:var(--bone); padding:11px 14px; border-radius:var(--radius-sm); border-left:3px solid var(--rose); }

  .fec-card { border:1px solid var(--line); border-left:4px solid var(--pc, var(--muted)); background:var(--panel); margin-top:8px;
    border-radius:var(--radius-sm); overflow:hidden; }
  .fec-row-btn { width:100%; display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; background:none; border:none; color:inherit; font:inherit;
    text-align:left; padding:12px 14px; cursor:pointer; }
  .fec-row-btn:hover { background:var(--panel2); }
  .fec-name { font-family:var(--font-head); font-weight:600; font-size:18px; letter-spacing:.005em; }
  .fec-tag { font-size:12px; color:var(--muted); }
  .fec-id { margin-left:auto; font-size:12px; color:var(--muted); font-family:var(--font-num); }
  .fec-inc { color:var(--brass); font-size:12px; font-weight:600; }

  .fec-drawer { border-top:1px solid var(--line-soft); padding:14px; display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; background:var(--panel2); }
  .fec-stat b { display:block; font-size:12px; color:var(--muted); font-weight:500; }
  .fec-stat span { font-size:15px; font-family:var(--font-num); }
  .fec-stat .pos { color:var(--brass); }
  .fec-drawer-actions { grid-column:1/-1; display:flex; gap:10px; }

  /* ---------- money race ---------- */
  .fec-race { margin-top:12px; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:2px 16px; }
  .fec-race-row { display:grid; grid-template-columns:minmax(170px, 250px) 1fr auto; gap:14px; align-items:center; padding:12px 0; border-bottom:1px solid var(--line-soft); }
  .fec-race > .fec-race-row:last-of-type { border-bottom:none; }
  .fec-race-name { font-family:var(--font-head); font-weight:600; font-size:17px; line-height:1.2; padding-left:10px; border-left:3px solid var(--pc, var(--muted)); }
  .fec-race-name small { display:block; font-family:var(--font-ui); font-weight:400; font-size:12px; color:var(--muted); margin-top:2px; }
  .fec-bars { display:grid; gap:5px; min-width:0; }
  .fec-barline { display:grid; grid-template-columns:1fr 72px; gap:10px; align-items:center; }
  .fec-bartrack { background:var(--ink); border-radius:3px; height:14px; position:relative; overflow:hidden; }
  .fec-barfill { position:absolute; top:0; bottom:0; left:0; min-width:2px; max-width:100%; border-radius:3px; }
  .fec-barfill.coh { background:repeating-linear-gradient(45deg, var(--pc), var(--pc) 4px, transparent 4px, transparent 7px); border-right:2px solid var(--pc); }
  .fec-barfill.rec { background:var(--pc); }
  .fec-barval { font-size:13px; text-align:right; font-family:var(--font-num); }
  .fec-legend { display:flex; gap:18px; margin-top:10px; color:var(--muted); font-size:12px; align-items:center; flex-wrap:wrap; }
  .fec-sw { display:inline-block; width:14px; height:10px; margin-right:6px; background:var(--muted); border-radius:2px; }
  .fec-sw.hatch { background:repeating-linear-gradient(45deg, var(--muted), var(--muted) 4px, transparent 4px, transparent 7px); }

  .fec-pager { margin-top:16px; display:flex; gap:10px; align-items:center; }
  .fec-pager button { background:var(--panel); border:1px solid var(--line); color:var(--bone); padding:6px 14px; font:inherit; cursor:pointer; border-radius:var(--radius-sm); }
  .fec-pager button:hover:not(:disabled) { border-color:var(--brass); }
  .fec-pager button:disabled { opacity:.35; cursor:default; }
  .fec-empty { margin-top:20px; color:var(--muted); border:1px dashed var(--line); border-radius:var(--radius); padding:28px 20px; text-align:center; }

  /* ---------- ledgers & tables ---------- */
  .fec-ledger { margin-top:14px; border:1px solid var(--line); border-top:3px solid var(--brass); background:var(--panel); border-radius:var(--radius); overflow:hidden; }
  .fec-ledger-head { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding:14px 16px; border-bottom:1px solid var(--line); }
  .fec-ledger-head .fec-name { font-size:20px; }
  .fec-ledger-head .close { margin-left:auto; background:none; border:1px solid var(--line); color:var(--muted); font:inherit; font-size:13px; padding:4px 12px; cursor:pointer; border-radius:var(--radius-sm); }
  .fec-ledger-head .close:hover { color:var(--bone); border-color:var(--bone); }
  .fec-ledger-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 16px; border-bottom:1px solid var(--line); background:var(--panel2); }

  .fec-table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .fec-flow-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .fec-flow-svg { width:100%; min-width:760px; display:block; }
  table.fec-table { width:100%; border-collapse:collapse; font-size:13px; }
  .fec-table th { text-align:left; font-size:12px; font-weight:600; color:var(--muted); padding:9px 12px; border-bottom:1px solid var(--line);
    white-space:nowrap; position:sticky; top:0; background:var(--panel); z-index:1; }
  .fec-table td { padding:8px 12px; border-bottom:1px solid var(--line-soft); vertical-align:top; }
  .fec-table tbody tr:last-child td { border-bottom:none; }
  .fec-table td.amt { text-align:right; color:var(--brass); white-space:nowrap; font-family:var(--font-num); }
  .fec-table th.amt { text-align:right; }
  .fec-table tr:hover td { background:var(--panel2); }
  .fec-table .sub, .fec-root .sub { color:var(--muted); font-size:12px; }
  .fec-badge { display:inline-block; margin-left:8px; padding:1px 7px; font-size:11px; font-weight:500; border:1px solid var(--olive); color:var(--olive);
    vertical-align:middle; border-radius:999px; }
  .fec-badge.memo { border-color:var(--muted); color:var(--muted); }
  .fec-profile-row td { background:var(--panel2); padding:0; }
  .fec-profile { padding:14px 16px; border-left:3px solid var(--olive); }
  .fec-profile-identity { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .fec-profile .chip { border:1px solid var(--line); padding:2px 9px; font-size:11px; color:var(--bone); border-radius:999px; }
  .fec-profile .chip.brass { border-color:var(--brass); color:var(--brass); }
  .fec-funders { margin:4px 0 0; padding:0; list-style:none; font-size:12px; max-width:560px; }
  .fec-funders li { display:flex; justify-content:space-between; gap:10px; padding:3px 0; border-bottom:1px solid var(--line-soft); }
  .fec-funders li b { font-weight:400; color:var(--brass); white-space:nowrap; font-family:var(--font-num); }
  .fec-profile-links { margin-top:12px; display:flex; gap:16px; flex-wrap:wrap; }
  .fec-profile-links a { color:var(--olive); font-size:13px; text-decoration:none; border-bottom:1px dotted var(--olive); }
  .fec-profile-links a:hover { color:var(--brass); border-color:var(--brass); }

  /* ---------- AI ---------- */
  .fec-ai { border-top:2px solid var(--olive); background:var(--panel2); padding:16px; }
  .fec-ai-label { color:var(--olive); font-size:12px; font-weight:600; margin-bottom:8px; }
  .fec-ai-text { white-space:pre-wrap; max-width:75ch; }
  .fec-ai-caveat { font-size:12px; color:var(--muted); font-style:italic; line-height:1.5; margin:-2px 0 10px; max-width:75ch; }
  .fec-ask { margin-top:12px; border:1px solid var(--line); border-left:3px solid var(--brass); background:var(--panel2); padding:14px 16px; border-radius:var(--radius-sm); }
  .fec-ask-bar { display:flex; gap:8px; align-items:center; }
  .fec-ask-input { flex:1; background:var(--ink); color:var(--bone); border:1px solid var(--line); padding:9px 12px; font:inherit; font-size:14px; }
  .fec-ask-suggest { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .fec-chip { background:none; border:1px solid var(--line); color:var(--muted); font:inherit; font-size:12px; padding:4px 10px; cursor:pointer; border-radius:999px; text-align:left; line-height:1.3; }
  .fec-chip:hover { border-color:var(--brass); color:var(--brass); }
  .fec-ask-trace { margin-top:10px; font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:3px; font-family:var(--font-num); }
  .fec-ask-tool { color:var(--olive); }
  .fec-ask-status { margin-top:8px; font-size:12px; color:var(--muted); display:flex; align-items:center; }
  .fec-extlink { color:var(--olive); text-decoration:none; white-space:nowrap; }
  .fec-extlink:hover { color:var(--brass); text-decoration:underline; }
  .fec-dossier { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .fec-dossier-msg { font-size:12px; color:var(--muted); }
  .fec-modal-overlay { position:fixed; inset:0; background:rgb(6 10 13 / .68); z-index:1000; display:flex; align-items:flex-start; justify-content:center;
    padding:28px 14px; overflow-y:auto; font-family:var(--font-ui); font-size:14px; line-height:1.5; color:var(--bone); }
  .fec-modal { background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--brass); max-width:920px; width:100%; margin:auto; text-align:left;
    border-radius:var(--radius); box-shadow:var(--shadow); }
  .fec-modal-head { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--line);
    position:sticky; top:0; background:var(--panel); flex-wrap:wrap; z-index:1; border-radius:var(--radius) var(--radius) 0 0; }
  .fec-modal-body { padding:14px 18px 22px; }
  .fec-dossier-top { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; margin-bottom:10px; }
  .fec-ask-sources { margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
  .fec-ask-source { margin-bottom:9px; }
  .fec-src-title { color:var(--olive); text-decoration:none; font-size:13px; line-height:1.4; }
  .fec-src-title:hover { color:var(--brass); }
  .fec-src-kind { display:inline-block; font-size:10px; font-weight:600; color:var(--ink); background:var(--olive); border-radius:3px; padding:1px 6px; margin-right:6px; vertical-align:middle; }
  .fec-src-snip { font-size:12px; color:var(--muted); line-height:1.45; margin-top:3px; max-width:80ch; }
  .fec-ai-aggs { margin-top:14px; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; }
  .fec-ai-aggs h4 { margin:0 0 6px; font-size:12px; color:var(--muted); font-weight:600; }
  .fec-ai-aggs ul { margin:0; padding:0; list-style:none; font-size:12px; }
  .fec-ai-aggs li { display:flex; justify-content:space-between; gap:8px; padding:3px 0; border-bottom:1px solid var(--line-soft); }
  .fec-ai-aggs li b { font-weight:400; color:var(--brass); white-space:nowrap; font-family:var(--font-num); }
  .fec-spin { color:var(--olive); }

  /* ---------- Tennessee hub ---------- */
  .tx-subnav { display:flex; gap:4px; margin-top:16px; padding:4px; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
    overflow-x:auto; scrollbar-width:none; }
  .tx-subnav::-webkit-scrollbar { display:none; }
  .tx-subnav button { background:none; border:none; color:var(--muted); font-size:13px; font-weight:500; padding:7px 13px; border-radius:var(--radius-sm);
    cursor:pointer; white-space:nowrap; }
  .tx-subnav button:hover { color:var(--bone); background:var(--panel2); }
  .tx-subnav button[aria-selected="true"] { background:var(--brass); color:var(--brass-ink); font-weight:600; }
  .tx-lede { margin:16px 0 0; color:var(--muted); max-width:78ch; }
  .tx-lede b { color:var(--bone); font-weight:600; }
  .tx-panel { margin-top:14px; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:16px 18px; }
  .tx-panel > h3, .tx-h { font-family:var(--font-head); font-size:17px; font-weight:600; margin:0 0 10px; }
  .tx-form { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px 14px; align-items:end; }
  .tx-form .wide { grid-column:span 2; }
  .tx-form .full { grid-column:1 / -1; }
  .tx-seg { display:inline-flex; border:1px solid var(--line); border-radius:var(--radius-sm); overflow:hidden; }
  .tx-seg button { background:none; border:none; color:var(--muted); font-size:13px; padding:7px 12px; cursor:pointer; border-right:1px solid var(--line); min-height:36px; }
  .tx-seg button:last-child { border-right:none; }
  .tx-seg button[aria-pressed="true"] { background:var(--panel3); color:var(--bone); font-weight:600; }
  .tx-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin-top:14px; }
  .tx-kpi { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:12px 14px; }
  .tx-kpi span { display:block; font-size:12px; color:var(--muted); }
  .tx-kpi b { display:block; font-family:var(--font-num); font-size:20px; font-weight:500; margin-top:2px; }
  .tx-kpi small { color:var(--muted); font-size:12px; }
  .tx-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:14px; margin-top:14px; }
  .tx-cols > .tx-panel { margin-top:0; min-width:0; }
  .tx-rank { list-style:none; margin:0; padding:0; }
  .tx-rank li { display:grid; grid-template-columns:1fr auto; gap:2px 12px; padding:7px 0; border-bottom:1px solid var(--line-soft); font-size:13px; position:relative; }
  .tx-rank li:last-child { border-bottom:none; }
  .tx-rank .nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .tx-rank .nm button { background:none; border:none; padding:0; color:inherit; font:inherit; cursor:pointer; text-align:left; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
  .tx-rank .nm button:hover { color:var(--brass); text-decoration:underline; }
  .tx-rank .amt { font-family:var(--font-num); color:var(--brass); white-space:nowrap; }
  .tx-rank .meter { grid-column:1 / -1; height:4px; background:var(--ink); border-radius:2px; overflow:hidden; }
  .tx-rank .meter i { display:block; height:100%; background:var(--bar, var(--brass)); border-radius:2px; opacity:.85; }
  .tx-note { margin-top:10px; font-size:12px; color:var(--muted); }
  .tx-note.warn { color:var(--warn); }
  .tx-pill { display:inline-block; font-size:11px; font-weight:500; padding:1px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); white-space:nowrap; }
  .tx-pill.win { border-color:var(--olive); color:var(--olive); }
  .tx-pill.dem { border-color:#5B82B8; color:#7FA3D6; }
  .tx-pill.rep { border-color:#B85B5B; color:#D98080; }
  :root[data-theme="light"] .tx-pill.dem { color:#2F5C97; }
  :root[data-theme="light"] .tx-pill.rep { color:#A23B3B; }
  .tx-race { border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:12px 14px; min-width:0; }
  .tx-race h4 { margin:0 0 8px; font-family:var(--font-head); font-size:16px; font-weight:600; display:flex; justify-content:space-between; gap:10px; align-items:baseline; }
  .tx-race h4 small { font-family:var(--font-num); font-weight:400; font-size:12px; color:var(--muted); }
  .tx-cand { display:grid; grid-template-columns:1fr auto; gap:1px 10px; padding:6px 0 6px 9px; border-left:3px solid var(--pc, var(--muted)); margin-top:6px; font-size:13px; }
  .tx-cand .meter { grid-column:1 / -1; height:4px; background:var(--ink); border-radius:2px; overflow:hidden; margin-top:3px; }
  .tx-cand .meter i { display:block; height:100%; background:var(--pc, var(--muted)); }
  .tx-linkbtn { background:none; border:none; padding:0; color:var(--olive); font:inherit; cursor:pointer; text-align:left; }
  .tx-linkbtn:hover { color:var(--brass); text-decoration:underline; }
  .tx-progress { height:6px; background:var(--ink); border-radius:3px; overflow:hidden; margin-top:8px; }
  .tx-progress i { display:block; height:100%; background:var(--brass); transition:width .3s ease; }

  @media (prefers-reduced-motion: no-preference) {
    .fec-barfill { transition:width .4s ease; }
    .fec-spin::after { content:"…"; animation:fecPulse 1.2s infinite; }
    @keyframes fecPulse { 50% { opacity:.3; } }
  }
  @media (max-width: 860px) {
    .app-bar-in { flex-wrap:wrap; gap:0 12px; padding:8px 14px 0; }
    .app-brand small { display:none; }
    .app-tools { margin-left:auto; }
    .app-nav { order:3; flex-basis:100%; height:42px; margin:0 -6px; }
    .status-pill span.lbl { display:none; }
  }
  @media (max-width: 640px) {
    .fec-wrap { padding:14px 12px 56px; }
    .fec-race { padding:2px 12px; }
    .fec-race-row { grid-template-columns:1fr; gap:8px; }
    .fec-controls { padding:12px; gap:10px; }
    .fec-ledger-head { padding:10px 12px; gap:8px; }
    .fec-ledger-head .fec-name { font-size:17px; }
    .fec-ledger-bar { padding:8px 12px; }
    .fec-table th, .fec-table td { padding:7px 8px; }
    .fec-flow-svg { min-width:620px; }
    .fec-profile, .fec-ai, .tx-panel { padding:12px; }
    .fec-modal-overlay { padding:10px 6px; }
    .fec-modal-body { padding:12px 12px 18px; }
    .fec-hint { max-width:100%; }
    .fec-status { flex-direction:column; align-items:flex-start; gap:8px; }
    .tx-form .wide, .tx-form > .fec-field { grid-column:1 / -1 !important; }
    .tx-cols { grid-template-columns:1fr !important; }
    .lc-split { grid-template-columns:1fr !important; }
    .lc-split > div { position:static !important; }
  }

  .fec-controls-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .fec-tab-nav { display:flex; gap:2px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; flex-shrink:0; }
  .fec-tab-nav::-webkit-scrollbar { display:none; }
`;
