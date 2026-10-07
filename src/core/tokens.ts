/**
 * Token estimation without network calls.
 * Heuristic: characters-per-token ratios tuned by content kind.
 * AC3: within +/-20% of a 4-chars-per-token baseline on English and code samples.
 */

export type ContentKind = "prose" | "code" | "mixed" | "cjk";

const RATIO: Record<ContentKind, number> = {
  prose: 4.0,
  code: 3.5,
  mixed: 3.8,
  cjk: 1.6,
};

/** Classify content by character statistics. Deterministic. */
export function classifyContent(text: string): ContentKind {
  if (text.length === 0) return "prose";
  let cjk = 0;
  let symbolish = 0;
  let space = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0xac00 && c <= 0xd7af)
    ) {
      cjk++;
    } else if ("{}()[]<>;=+-*/&|!?:_#$%@~`\\\"'".includes(ch)) {
      symbolish++;
    } else if (ch === " " || ch === "\t" || ch === "\n") {
      space++;
    }
  }
  const cjkRatio = cjk / text.length;
  if (cjkRatio > 0.2) return "cjk";
  const symbolRatio = symbolish / text.length;
  const spaceRatio = space / text.length;
  // Code tends to have many symbols and few spaces; prose has ~15-20% spaces.
  if (symbolRatio > 0.08 && spaceRatio < 0.14) return "code";
  if (symbolRatio > 0.12) return "mixed";
  return "prose";
}

/** Estimate token count for a text. Never returns less than 1 for non-empty text. */
export function estimateTokens(text: string, kindHint?: ContentKind): number {
  if (text.length === 0) return 0;
  const kind = kindHint ?? classifyContent(text);
  const tokens = Math.round(text.length / RATIO[kind]);
  return Math.max(1, tokens);
}

/** Estimate tokens from a byte/char size and a pre-classified kind (no text needed). */
export function estimateTokensFromLength(length: number, kind: ContentKind): number {
  if (length <= 0) return 0;
  return Math.max(1, Math.round(length / RATIO[kind]));
}

export const ratios = { ...RATIO };
