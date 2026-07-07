// Pluggable web search for the agentic Ask-AI feature.
// Default provider: Tavily (built for LLM agents — returns clean extracted page
// content + a synthesized answer, which keeps prompts small and lowers the
// prompt-injection surface). Brave and SerpAPI are supported too. With no key
// configured the module degrades gracefully so the agent can still answer from
// FEC/TN/Wikipedia/news without web access.

import { cacheGet, cacheSet } from "./db.js";

const PROVIDER = (process.env.SEARCH_PROVIDER || "tavily").toLowerCase();
// Key fallback must be keyed on the selected provider — a flat OR-chain would send
// e.g. a Tavily key as Brave's X-Subscription-Token when both are in the env.
const PROVIDER_KEYS = {
  tavily: process.env.TAVILY_API_KEY,
  brave: process.env.BRAVE_API_KEY,
  serpapi: process.env.SERPAPI_API_KEY,
};
const KEY = process.env.SEARCH_API_KEY || PROVIDER_KEYS[PROVIDER] || "";
const TTL = Number(process.env.SEARCH_CACHE_TTL_MS || 3_600_000); // 1h
const TIMEOUT = Number(process.env.SEARCH_TIMEOUT_MS || 15_000);

export function searchConfigured() {
  return Boolean(KEY);
}

export function searchProvider() {
  return KEY ? PROVIDER : "none";
}

const TOPICS = new Set(["general", "news", "finance"]);
const TIME_RANGES = new Set(["day", "week", "month", "year"]);

// Returns { configured, provider, answer?, topic, results: [{title,url,content}], note? }
export async function webSearch(query, { maxResults = 5, topic = "general", timeRange = null, noCache = false } = {}) {
  const q = String(query || "").trim().slice(0, 400);
  const t = TOPICS.has(String(topic)) ? String(topic) : "general";
  const tr = TIME_RANGES.has(String(timeRange)) ? String(timeRange) : null;
  if (!q) return { configured: searchConfigured(), provider: searchProvider(), results: [], note: "Empty query." };
  if (!KEY) {
    return {
      configured: false, provider: "none", results: [],
      note: "Web search is not configured (set SEARCH_API_KEY). Answering from FEC/TN/Wikipedia/news only.",
    };
  }

  const ck = `search:${PROVIDER}:${maxResults}:${t}:${tr || "-"}:${q.toLowerCase()}`;
  if (!noCache) {
    const hit = cacheGet(ck);
    if (hit) return { ...hit, cached: true };
  }

  let out;
  try {
    if (PROVIDER === "brave") out = await brave(q, maxResults);
    else if (PROVIDER === "serpapi") out = await serpapi(q, maxResults);
    else out = await tavily(q, maxResults, t, tr);
  } catch (e) {
    return { configured: true, provider: PROVIDER, topic: t, results: [], note: `Web search failed: ${e.message}` };
  }
  if (out.results?.length || out.answer) cacheSet(ck, out, TTL);
  return out;
}

async function tavily(query, maxResults, topic = "general", timeRange = null) {
  const body = {
    query, max_results: maxResults, topic,
    search_depth: "basic",
    include_answer: "advanced", // richer LLM synthesis, no extra credits (credits scale with search_depth)
    include_raw_content: false,
  };
  if (timeRange) body.time_range = timeRange;
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    // Tavily's spec uses Bearer auth (Authorization: Bearer tvly-...). We also keep
    // api_key in the body for older accounts; sending both is harmless.
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ api_key: KEY, ...body }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Tavily HTTP ${r.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
  }
  const d = await r.json();
  return {
    configured: true, provider: "tavily", topic,
    answer: d.answer || null,
    results: (d.results || []).slice(0, maxResults).map((x) => ({
      title: x.title || "", url: x.url || "", content: String(x.content || "").slice(0, 1500),
    })),
  };
}

async function brave(query, maxResults) {
  const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const r = await fetch(u, {
    headers: { accept: "application/json", "X-Subscription-Token": KEY },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
  const d = await r.json();
  return {
    configured: true, provider: "brave", answer: null, topic: "general",
    results: (d.web?.results || []).slice(0, maxResults).map((x) => ({
      title: x.title || "", url: x.url || "", content: String(x.description || "").slice(0, 1500),
    })),
  };
}

async function serpapi(query, maxResults) {
  const u = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${maxResults}&api_key=${encodeURIComponent(KEY)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`SerpAPI HTTP ${r.status}`);
  const d = await r.json();
  return {
    configured: true, provider: "serpapi", topic: "general",
    answer: d.answer_box?.answer || d.answer_box?.snippet || null,
    results: (d.organic_results || []).slice(0, maxResults).map((x) => ({
      title: x.title || "", url: x.link || "", content: String(x.snippet || "").slice(0, 1500),
    })),
  };
}
