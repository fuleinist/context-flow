/**
 * Suggestion engine (F6). Emits ranked, actionable suggestions. Every
 * suggestion carries an expected token delta (negative = savings).
 * Pinned sources are never suggested for removal (AC6).
 */

import type { ClassifiedSource } from "./cache";
import type { ContextSource } from "./scanner";

export type SuggestionAction = "remove" | "trim" | "pin" | "add";

export interface Suggestion {
  action: SuggestionAction;
  sourceId: string | null;
  label: string;
  reason: string;
  /** Expected token delta. Negative means tokens saved. */
  tokenDelta: number;
  /** Higher priority sorts first. */
  priority: number;
}

export interface SuggestInput {
  sources: readonly ClassifiedSource[];
  windowSize: number;
  totalTokens: number;
  /** Workspace-relative candidate files the user could add (relevance-scored elsewhere). */
  addCandidates?: readonly { id: string; label: string; tokens: number }[];
}

const TRIM_TARGET_RATIO = 0.5; // trimming is assumed to halve an oversized source
const HIGH_USAGE = 0.8;
const OVERSIZE_SHARE = 0.25; // a single source using >25% of the window is oversized

export function suggest(input: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  const usage = input.windowSize > 0 ? input.totalTokens / input.windowSize : 0;

  for (const s of input.sources) {
    const share = input.windowSize > 0 ? s.tokens / input.windowSize : 0;

    // Oversized stable source -> trim (never remove rules outright).
    if (share > OVERSIZE_SHARE && s.kind === "rules") {
      out.push({
        action: "trim",
        sourceId: s.id,
        label: `Trim ${s.label}`,
        reason: `Uses ${pct(share)} of the window every turn. Split it or cut stale sections.`,
        tokenDelta: -Math.round(s.tokens * (1 - TRIM_TARGET_RATIO)),
        priority: 90,
      });
      continue;
    }

    // Volatile and large under high usage -> remove, unless pinned (AC6).
    if (usage > HIGH_USAGE && s.stability === "volatile" && !s.pinned && s.tokens > 0) {
      out.push({
        action: "remove",
        sourceId: s.id,
        label: `Remove ${s.label}`,
        reason: `Volatile content re-sent every turn while the window is ${pct(usage)} full.`,
        tokenDelta: -s.tokens,
        priority: 80,
      });
      continue;
    }

    // Large semi-stable file, not pinned -> offer pin so it stays cached.
    if (s.stability === "semi-stable" && !s.pinned && share > 0.05) {
      out.push({
        action: "pin",
        sourceId: s.id,
        label: `Pin ${s.label}`,
        reason: "Pinning keeps this file in the stable prefix so providers can cache it.",
        tokenDelta: 0,
        priority: 40,
      });
    }
  }

  // Low usage -> suggest adding a relevant file, if candidates exist.
  if (usage < 0.4) {
    for (const c of input.addCandidates ?? []) {
      if (input.sources.some((s) => s.id === c.id)) continue;
      out.push({
        action: "add",
        sourceId: c.id,
        label: `Add ${c.label}`,
        reason: "Window has spare room. Include this file so the assistant sees it.",
        tokenDelta: c.tokens,
        priority: 20,
      });
    }
  }

  return out.sort((a, b) => b.priority - a.priority || a.tokenDelta - b.tokenDelta);
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Total tokens for a source list. */
export function totalTokens(sources: readonly ContextSource[]): number {
  return sources.reduce((sum, s) => sum + s.tokens, 0);
}
