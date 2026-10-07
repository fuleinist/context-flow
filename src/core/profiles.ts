/**
 * Model profiles (F7). Window sizes are configurable via extension settings;
 * this module provides the defaults and the usage math.
 */

export interface ProfileSet {
  [name: string]: number;
}

export const DEFAULT_PROFILES: ProfileSet = {
  "claude-200k": 200000,
  "gpt-128k": 128000,
  "gemini-1m": 1000000,
};

export interface Usage {
  profile: string;
  windowSize: number;
  usedTokens: number;
  /** 0..1+ (can exceed 1 when over budget). */
  usage: number;
  overBudget: boolean;
}

export function resolveWindowSize(
  profiles: ProfileSet,
  activeProfile: string,
  fallback: number,
): number {
  const size = profiles[activeProfile];
  if (typeof size === "number" && size > 0) return size;
  return fallback > 0 ? fallback : 200000;
}

export function computeUsage(
  profile: string,
  windowSize: number,
  usedTokens: number,
): Usage {
  const w = windowSize > 0 ? windowSize : 1;
  const usage = usedTokens / w;
  return {
    profile,
    windowSize,
    usedTokens,
    usage,
    overBudget: usage > 1,
  };
}
