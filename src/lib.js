// Small shared helpers for the newer modules (App.jsx still carries its own copies).
export const fmtUSD = (n) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
export const fmtUSDshort = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
};
export const fmtNum = (n) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(n));
export const timeAgo = (epochMs) => {
  if (!epochMs) return null;
  const s = Math.round((Date.now() - epochMs) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
export const PARTY_COLOR = { DEM: "#5B82B8", REP: "#B85B5B", IND: "#8F8F7A", LIB: "#C9A648", GRE: "#6FA06B" };
export const partyColor = (p) => {
  const u = (p || "").toUpperCase();
  if (u.startsWith("DEM")) return PARTY_COLOR.DEM;
  if (u.startsWith("REP")) return PARTY_COLOR.REP;
  if (u.startsWith("LIB")) return PARTY_COLOR.LIB;
  if (u.startsWith("GRE")) return PARTY_COLOR.GRE;
  if (u.startsWith("IND")) return PARTY_COLOR.IND;
  return "#7C8A92";
};

// CSV download with the same spreadsheet formula-injection guard App.jsx uses (third-party data).
export function downloadCSV(filename, headers, rows) {
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// fetch → JSON with the server's { error: { message } } convention surfaced as a thrown Error.
export async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (HTTP ${res.status})`);
  return data;
}
