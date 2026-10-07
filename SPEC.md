# context-flow — SPEC

A VS Code / Cursor extension that visualizes your AI assistant's context window in real time. It shows what is included, estimates what is cached, and suggests what to add or remove for better context management.

## Problem

AI coding assistants are opaque about the context they send. Users do not know which files, rules, and instructions consume the window. This wastes budget and degrades answers.

## Goals

- G1: Show a live context-window breakdown for the active workspace.
- G2: Estimate token cost per context source (open files, rules files, selection, git diff).
- G3: Flag items that are likely cached vs. re-sent every turn.
- G4: Suggest concrete add/remove actions with expected token savings or cost.
- G5: Work in VS Code and Cursor with zero runtime dependencies.

## Features

- F1: `Context Flow: Open Dashboard` command opens a webview panel with a real-time breakdown.
- F2: Status bar item shows total estimated tokens and window usage percent for the active profile.
- F3: Context scanner collects sources: open editors, workspace rules files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/**`, `.github/copilot-instructions.md`), current selection, and staged git diff.
- F4: Token estimator counts tokens without network calls (heuristic chars-per-token with language-aware ratios).
- F5: Cache classifier labels each source as `stable` (likely cached), `semi-stable`, or `volatile` based on edit frequency and file kind.
- F6: Suggestion engine emits ranked actions: remove, trim, pin, or add. Each action states expected token delta.
- F7: Model profile selector: configurable window sizes (e.g. 200k, 128k, 1M) via settings; per-profile usage bar.
- F8: Dashboard auto-refreshes on editor change, file save, and selection change (debounced).
- F9: `Context Flow: Copy Report` command copies a markdown snapshot of the breakdown to the clipboard.
- F10: All scanning logic is pure and testable outside VS Code (core module has no `vscode` import).

## Acceptance Criteria

- AC1: `npm run compile` passes with `tsc --strict`, zero errors.
- AC2: `npm test` runs node:test unit tests over the core module; all green.
- AC3: Core token estimator is within ±20% of a 4-chars-per-token baseline on sample English and code inputs.
- AC4: Scanner finds rules files in a fixture workspace and reports byte/token sizes for each.
- AC5: Cache classifier is deterministic for the same inputs.
- AC6: Suggestion engine never suggests removing a file the user pinned, and every suggestion includes a token delta.
- AC7: `package.json` declares commands, settings, activation events, and zero runtime dependencies.
- AC8: Webview HTML renders from a pure `renderDashboard(state)` function that unit tests can call directly.

## Non-goals

- No network calls, no telemetry, no LLM calls from the extension itself.
- No interception of actual assistant traffic (estimation only; providers' real payloads are not observable from an extension).
- No packaging/publishing to the Marketplace in this iteration (vsce-ready layout only).

## Architecture

```
src/
  core/            # pure logic, no vscode imports
    tokens.ts      # F4 estimator
    scanner.ts     # F3 source collection (fs-based, injectable)
    cache.ts       # F5 classifier
    suggest.ts     # F6 suggestion engine
    profiles.ts    # F7 model profiles
    render.ts      # F10/AC8 dashboard HTML renderer
  extension.ts     # vscode glue: commands, status bar, watchers (F1, F2, F8, F9)
test/              # node:test unit tests over core (AC2)
```

## Iteration budget

Max 10 spec→build→verify cycles. Commit after each cycle.
