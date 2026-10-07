/**
 * Context source scanner (F3). Pure logic: all IO goes through an injectable
 * ScannerHost so unit tests can run against fixtures without touching disk.
 */

import { estimateTokens, estimateTokensFromLength } from "./tokens";

export type SourceKind =
  | "rules"
  | "open-editor"
  | "selection"
  | "git-diff";

export interface ContextSource {
  /** Stable identifier, e.g. workspace-relative path or "selection". */
  id: string;
  kind: SourceKind;
  /** Human-readable label for the dashboard. */
  label: string;
  /** Character length of the content that would be sent. */
  chars: number;
  /** Estimated tokens. */
  tokens: number;
  /** True when the backing document has unsaved changes. */
  dirty: boolean;
  /** User pinned this source; suggestions must not remove it (AC6). */
  pinned: boolean;
}

export interface EditorInfo {
  path: string;
  label: string;
  chars: number;
  dirty: boolean;
  pinned?: boolean;
}

export interface ScannerHost {
  /** Return text of a file, or null when missing/unreadable. */
  readTextFile(path: string): string | null;
  /** Return file names directly inside a directory, or [] when missing. */
  listFiles(dir: string): string[];
  /** True when the path exists (file or directory). */
  exists(path: string): boolean;
  /** Workspace root; "" means no workspace open. */
  workspaceRoot: string;
}

/** Rules files known to AI assistants, relative to workspace root. */
export const RULES_PATHS: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".windsurfrules",
  "GEMINI.md",
];

export const CURSOR_RULES_DIR = ".cursor/rules";

function join(root: string, rel: string): string {
  if (root === "") return rel;
  const sep = root.includes("\\") ? "\\" : "/";
  return root + sep + rel.split("/").join(sep);
}

function makeSource(
  id: string,
  kind: SourceKind,
  label: string,
  chars: number,
  dirty: boolean,
  pinned: boolean,
  text?: string,
): ContextSource {
  // With real text available we classify precisely; otherwise we use a
  // size-only estimate with a kind-appropriate default ratio.
  const tokens =
    text !== undefined
      ? estimateTokens(text)
      : estimateTokensFromLength(chars, kind === "rules" ? "prose" : "mixed");
  return { id, kind, label, chars, dirty, pinned, tokens };
}

/** Collect rules-file sources from the workspace (F3). */
export function scanRulesFiles(host: ScannerHost): ContextSource[] {
  const out: ContextSource[] = [];
  for (const rel of RULES_PATHS) {
    const abs = join(host.workspaceRoot, rel);
    if (!host.exists(abs)) continue;
    const text = host.readTextFile(abs);
    if (text === null) continue;
    out.push(
      makeSource(`rules:${rel}`, "rules", rel, text.length, false, false, text),
    );
  }
  // .cursor/rules/** (flat listing is enough: rules are files in that dir)
  const dirAbs = join(host.workspaceRoot, CURSOR_RULES_DIR);
  if (host.exists(dirAbs)) {
    for (const name of host.listFiles(dirAbs).sort()) {
      if (!/\.(md|mdc|txt)$/i.test(name)) continue;
      const text = host.readTextFile(join(dirAbs, name));
      if (text === null) continue;
      const rel = `${CURSOR_RULES_DIR}/${name}`;
      out.push(makeSource(`rules:${rel}`, "rules", rel, text.length, false, false, text));
    }
  }
  return out;
}

/** Build sources for open editors. */
export function scanEditors(editors: readonly EditorInfo[]): ContextSource[] {
  return editors.map((e) =>
    makeSource(`editor:${e.path}`, "open-editor", e.label, e.chars, e.dirty, e.pinned ?? false),
  );
}

/** Build a source for the active selection (empty selection = no source). */
export function selectionSource(chars: number): ContextSource | null {
  if (chars <= 0) return null;
  return makeSource("selection", "selection", "Active selection", chars, true, false);
}

/** Build a source for the staged git diff (empty diff = no source). */
export function gitDiffSource(diffChars: number): ContextSource | null {
  if (diffChars <= 0) return null;
  return makeSource("git-diff", "git-diff", "Staged git diff", diffChars, true, false);
}

export interface ScanInput {
  editors?: readonly EditorInfo[];
  selectionChars?: number;
  gitDiffChars?: number;
  /** Ids of sources the user pinned. */
  pinnedIds?: readonly string[];
}

/** Full scan (F3): rules + editors + selection + diff, with pins applied. */
export function scanContext(host: ScannerHost, input: ScanInput = {}): ContextSource[] {
  const pinned = new Set(input.pinnedIds ?? []);
  const sources: ContextSource[] = [
    ...scanRulesFiles(host),
    ...scanEditors(input.editors ?? []),
  ];
  const sel = selectionSource(input.selectionChars ?? 0);
  if (sel) sources.push(sel);
  const diff = gitDiffSource(input.gitDiffChars ?? 0);
  if (diff) sources.push(diff);
  for (const s of sources) {
    if (pinned.has(s.id)) s.pinned = true;
  }
  return sources;
}
