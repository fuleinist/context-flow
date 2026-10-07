/**
 * Cache classifier (F5). Labels each source by how likely it is to be
 * cache-hit material for prompt-caching providers. Deterministic (AC5):
 * same inputs always produce the same label.
 */

import type { ContextSource } from "./scanner";

export type Stability = "stable" | "semi-stable" | "volatile";

export interface ClassifiedSource extends ContextSource {
  stability: Stability;
  /** True when the content is likely served from provider cache. */
  likelyCached: boolean;
}

/**
 * Classify one source.
 * - rules files: stable (rarely edited, identical prefix each turn -> cached)
 * - clean open editors: semi-stable (cached while unmodified)
 * - dirty editors, selection, diff: volatile (re-sent every turn)
 */
export function classifyStability(source: ContextSource): Stability {
  if (source.kind === "rules") return "stable";
  if (source.kind === "selection") return "volatile";
  if (source.kind === "git-diff") return "volatile";
  return source.dirty ? "volatile" : "semi-stable";
}

/** A source counts as likely-cached when it is stable, or semi-stable and clean. */
export function isLikelyCached(stability: Stability, dirty: boolean): boolean {
  if (stability === "stable") return true;
  if (stability === "semi-stable") return !dirty;
  return false;
}

export function classifyAll(sources: readonly ContextSource[]): ClassifiedSource[] {
  return sources.map((s) => {
    const stability = classifyStability(s);
    return { ...s, stability, likelyCached: isLikelyCached(stability, s.dirty) };
  });
}
