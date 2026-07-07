// Central place for detecting when an LLM "defers" (announces a plan instead of answering),
// refuses, or otherwise emits a non-answer. Every AI call path imports from here so the app
// never surfaces "let me look that up…" / "I'll now proceed…" style messages to the user.
//
// Two layers of defense use these:
//   1. Agentic loops nudge the model and require that tools were actually called.
//   2. Plain narrative calls strip a leading preamble and reject what's left if it's a non-answer.

// Deferral: first-/second-person announcement of intent to take steps or use tools.
export const DEFERRAL_RE =
  /\b(let me|let us|let'?s|i'?ll|i will|we'?ll|we will|i'?m going to|i am going to|we'?re going to|i need to|we need to|i'?m about to|i'?m gonna|going to|i can|we can|i should|we should|i'?d|i would|we would|first,? (i|we)|next,? (i|we)|now (i|we))\s+(look|search|check|find|pull|use|call|get|gather|retriev|quer|begin|start|proceed|delve|dig|do that|do this|investigat|review|examine|analyz|access|consult|explore|move on)/i;

// Preamble: apologizes, says it will "now proceed", "start by", "after that…", or trails into a
// "here's what I'll do:" lead-in.
export const PREAMBLE_RE =
  /\b(i apologi[sz]e|my apolog|i'?ll now|i will now|we'?ll now|i'?ll go ahead|i will go ahead|let'?s (start|begin|get started|dive|proceed|move|continue)|i'?ll (start|begin|proceed)|i will (start|begin|proceed)|proceed(ing)? (with|to)|begin(ning)? (with|by)|start(ing)? (with|by)|after (that|this),? (we|i)|to (answer|address) (this|that|your)|here'?s (what|how) (i|we)|sure[,!.]? (let|i'?ll|i will|here)|certainly[,!.]? (let|i'?ll|i will|here)|of course[,!.]? (let|i'?ll|i will|here))\b/i;

// Refusal / punt: claims it lacks tools/ability, or sends the user somewhere else to look.
export const REFUSAL_RE =
  /\b(don'?t|do not|cannot|can'?t|unable to|not able to|no ability to|without (the )?(ability|access))\b[^.]{0,60}\b(capabilit|abilit|access|browse|retriev|look up|search|internet|real[- ]?time|tools?|current (data|information))\b|you (might|may|could|can|should|will) (want to |need to |)?(check|visit|look|find|search|refer|consult)|i (would |)?(recommend|suggest|encourage|advise) (checking|visiting|looking|searching|consulting|that you|you (check|visit|look))|(check|visit|see|refer to|consult) (her|his|their|the candidate'?s|the official|its) (official |campaign |)(website|social|page|site|profile)/i;

const trimmed = (s) => String(s == null ? "" : s).trim();

// True when the (short) text reads as a deferral / preamble / bare "…:" lead-in. Long text is
// treated as real content — the deferral problem is short, planning-only messages.
export function looksLikeDeferral(s) {
  const t = trimmed(s);
  if (!t || t.length >= 800) return false;
  return DEFERRAL_RE.test(t) || PREAMBLE_RE.test(t) || (/:\s*$/.test(t) && t.length < 450);
}

export function looksLikeRefusal(s) {
  const t = trimmed(s);
  return Boolean(t) && t.length < 1200 && REFUSAL_RE.test(t);
}

// True when the text is NOT a usable answer (deferral, preamble, refusal, or empty).
export function looksLikeNonAnswer(s) {
  const t = trimmed(s);
  if (!t) return true;
  return looksLikeDeferral(t) || looksLikeRefusal(t);
}

export const isUsableAnswer = (s) => !looksLikeNonAnswer(s);

// Strip <think> blocks and leading deferral/preamble sentences, keeping the substantive
// remainder. e.g. "Sure, let me analyze. Smith raised $5M…" -> "Smith raised $5M…"
export function cleanAnswer(raw) {
  let t = trimmed(String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, ""));
  if (!t) return "";
  const parts = t.split(/(?<=[.!?:])\s+/);
  let i = 0;
  while (i < parts.length) {
    const p = parts[i].trim();
    if (DEFERRAL_RE.test(p) || PREAMBLE_RE.test(p) || /:\s*$/.test(p)) i++;
    else break;
  }
  return parts.slice(i).join(" ").trim();
}

// One-stop: clean the raw model output, then return it only if it's a usable answer; else "".
export function usableAnswerOrEmpty(raw) {
  const cleaned = cleanAnswer(raw);
  return cleaned && !looksLikeNonAnswer(cleaned) ? cleaned : "";
}
