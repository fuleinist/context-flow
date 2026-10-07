# Context Flow

A VS Code / Cursor extension that visualizes your AI assistant's context window in real time. See what is included, what is likely cached, and get concrete suggestions on what to add or remove.

AI coding assistants are opaque about the context they send. Context Flow estimates it locally — no network calls, no telemetry, no LLM calls.

## Features

- **Live dashboard** — `Context Flow: Open Dashboard` opens a webview with a full breakdown: usage bar, per-source token counts, cache stability, ranked suggestions.
- **Status bar** — estimated tokens and window usage percent, always visible. Turns red when over budget.
- **Context scanner** — collects rules files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/**`, `.github/copilot-instructions.md`, `.windsurfrules`, `GEMINI.md`), open editors, and the active selection.
- **Token estimator** — offline heuristic with language-aware ratios (prose, code, CJK). Within ±20% of a 4-chars-per-token baseline on typical inputs.
- **Cache classifier** — labels every source `stable`, `semi-stable`, or `volatile` so you can see what providers can cache and what is re-sent every turn.
- **Suggestions** — ranked actions (remove / trim / pin / add), each with an expected token delta. Pinned sources are never suggested for removal.
- **Model profiles** — configurable window sizes (Claude 200k, GPT 128k, Gemini 1M by default). `Context Flow: Set Model Profile` switches.
- **Copy report** — `Context Flow: Copy Report` copies a markdown snapshot to the clipboard.
- **Auto-refresh** — debounced updates on editor change, selection change, and file save.

## Install (development)

```bash
git clone https://github.com/fuleinist/context-flow
cd context-flow
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host, or package with `vsce package`.

## Commands

| Command | Action |
| --- | --- |
| `Context Flow: Open Dashboard` | Open the live context dashboard |
| `Context Flow: Copy Report` | Copy a markdown report to the clipboard |
| `Context Flow: Set Model Profile` | Switch the active window-size profile |
| `Context Flow: Refresh Now` | Force a rescan |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `contextFlow.windowSize` | `200000` | Window size in tokens for the active profile |
| `contextFlow.profiles` | claude-200k / gpt-128k / gemini-1m | Named profiles mapping to window sizes |
| `contextFlow.activeProfile` | `claude-200k` | Active profile name |
| `contextFlow.refreshDebounceMs` | `500` | Auto-refresh debounce |
| `contextFlow.excludeGlobs` | node_modules, out, dist, .git | Globs excluded from scanning |

## Development

```bash
npm run compile   # tsc --strict
npm test          # node:test unit tests over the pure core
```

All analysis logic lives in `src/core/` and has zero `vscode` imports, so it runs under plain Node for tests. `src/extension.ts` is thin glue.

## How accurate is this?

Estimates are heuristic. Extensions cannot observe the real payloads that providers send, so Context Flow models what an assistant would typically include: rules files, open editors, selection. Use it to find bloat and trends, not as billing truth.

## License

MIT
