/**
 * Dashboard renderer (F1 / AC8). Pure function: takes serializable state and
 * returns a full HTML document string. Unit-testable without VS Code.
 * No scripts are loaded from the network; the page uses a small inline
 * script only for the refresh message hook when run inside the webview.
 */

import type { ClassifiedSource } from "./cache";
import type { Suggestion } from "./suggest";
import type { Usage } from "./profiles";

export interface DashboardState {
  usage: Usage;
  sources: readonly ClassifiedSource[];
  suggestions: readonly Suggestion[];
  /** Epoch ms of the last scan. */
  scannedAt: number;
  /** Tokens likely served from cache. */
  cachedTokens: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function usageBar(u: Usage): string {
  const pct = Math.min(100, Math.round(u.usage * 100));
  const barColor = u.overBudget ? "#d33" : pct > 80 ? "#e8a33d" : "#4caf7d";
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="fill" style="width:${pct}%;background:${barColor}"></div>
  </div>
  <p class="usage-line">${fmtTokens(u.usedTokens)} / ${fmtTokens(u.windowSize)} tokens (${pct}%) &mdash; profile <b>${esc(u.profile)}</b>${u.overBudget ? " &mdash; <span class=\"over\">OVER BUDGET</span>" : ""}</p>`;
}

function stabilityBadge(s: ClassifiedSource): string {
  const cls = s.stability === "stable" ? "st-stable" : s.stability === "semi-stable" ? "st-semi" : "st-vol";
  const cached = s.likelyCached ? " &#10003; cached" : "";
  return `<span class="badge ${cls}">${esc(s.stability)}${cached}</span>`;
}

function sourceRows(sources: readonly ClassifiedSource[]): string {
  if (sources.length === 0) return `<tr><td colspan="5" class="empty">No context sources found.</td></tr>`;
  const sorted = [...sources].sort((a, b) => b.tokens - a.tokens);
  return sorted
    .map(
      (s) => `<tr>
      <td>${esc(s.label)}${s.pinned ? " &#128204;" : ""}${s.dirty ? " <em>(dirty)</em>" : ""}</td>
      <td>${esc(s.kind)}</td>
      <td>${stabilityBadge(s)}</td>
      <td class="num">${fmtTokens(s.tokens)}</td>
      <td class="num">${fmtTokens(s.chars)}</td>
    </tr>`,
    )
    .join("\n");
}

function suggestionItems(suggestions: readonly Suggestion[]): string {
  if (suggestions.length === 0) return `<li class="empty">No suggestions. Context looks healthy.</li>`;
  return suggestions
    .map((s) => {
      const delta =
        s.tokenDelta === 0
          ? "no token change"
          : s.tokenDelta < 0
            ? `saves ~${fmtTokens(-s.tokenDelta)} tokens`
            : `costs ~${fmtTokens(s.tokenDelta)} tokens`;
      return `<li><span class="act act-${s.action}">${s.action}</span> <b>${esc(s.label)}</b> &mdash; ${esc(s.reason)} <em>(${delta})</em></li>`;
    })
    .join("\n");
}

/** Render the full dashboard HTML. Pure and deterministic. */
export function renderDashboard(state: DashboardState): string {
  const when = new Date(state.scannedAt).toISOString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context Flow</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); padding: 16px; }
  h1 { font-size: 1.2em; margin: 0 0 8px; }
  h2 { font-size: 1em; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
  .bar { height: 14px; background: rgba(128,128,128,0.25); border-radius: 7px; overflow: hidden; }
  .fill { height: 100%; border-radius: 7px; }
  .usage-line { margin: 6px 0 0; }
  .over { color: #d33; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(128,128,128,0.2); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { padding: 1px 6px; border-radius: 8px; font-size: 0.85em; }
  .st-stable { background: rgba(76,175,125,0.25); }
  .st-semi { background: rgba(232,163,61,0.25); }
  .st-vol { background: rgba(211,51,51,0.25); }
  ul { padding-left: 18px; }
  .act { display: inline-block; min-width: 52px; text-align: center; padding: 1px 6px; border-radius: 8px; font-size: 0.85em; background: rgba(128,128,128,0.25); }
  .act-remove { background: rgba(211,51,51,0.3); }
  .act-trim { background: rgba(232,163,61,0.3); }
  .act-pin { background: rgba(76,145,211,0.3); }
  .act-add { background: rgba(76,175,125,0.3); }
  .empty { opacity: 0.6; font-style: italic; }
  footer { margin-top: 20px; opacity: 0.6; font-size: 0.85em; }
</style>
</head>
<body>
<h1>Context Flow</h1>
${usageBar(state.usage)}
<p>Cached-friendly content: <b>${fmtTokens(state.cachedTokens)}</b> tokens</p>
<h2>Context sources</h2>
<table>
  <thead><tr><th>Source</th><th>Kind</th><th>Stability</th><th>Tokens</th><th>Chars</th></tr></thead>
  <tbody>
${sourceRows(state.sources)}
  </tbody>
</table>
<h2>Suggestions</h2>
<ul>
${suggestionItems(state.suggestions)}
</ul>
<footer>Last scan: ${esc(when)} &mdash; estimates are heuristic; provider payloads are not observable from the extension.</footer>
</body>
</html>`;
}

/** Markdown snapshot for the Copy Report command (F9). Pure. */
export function renderReport(state: DashboardState): string {
  const lines: string[] = [];
  const u = state.usage;
  lines.push(`# Context Flow report`);
  lines.push("");
  lines.push(`- Profile: ${u.profile} (${u.windowSize} tokens)`);
  lines.push(`- Used: ${u.usedTokens} tokens (${Math.round(u.usage * 100)}%)${u.overBudget ? " — OVER BUDGET" : ""}`);
  lines.push(`- Cached-friendly: ${state.cachedTokens} tokens`);
  lines.push(`- Scanned: ${new Date(state.scannedAt).toISOString()}`);
  lines.push("");
  lines.push(`## Sources`);
  lines.push("");
  lines.push(`| Source | Kind | Stability | Tokens |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const s of [...state.sources].sort((a, b) => b.tokens - a.tokens)) {
    lines.push(`| ${s.label}${s.pinned ? " (pinned)" : ""} | ${s.kind} | ${s.stability}${s.likelyCached ? ", cached" : ""} | ${s.tokens} |`);
  }
  lines.push("");
  lines.push(`## Suggestions`);
  lines.push("");
  if (state.suggestions.length === 0) {
    lines.push(`- None. Context looks healthy.`);
  }
  for (const s of state.suggestions) {
    lines.push(`- **${s.action}** ${s.label} — ${s.reason} (token delta: ${s.tokenDelta})`);
  }
  return lines.join("\n");
}
