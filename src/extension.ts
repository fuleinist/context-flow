/**
 * VS Code / Cursor extension glue (F1, F2, F8, F9).
 * All analysis lives in src/core (pure). This file only wires vscode APIs.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { classifyAll } from "./core/cache";
import { computeUsage, DEFAULT_PROFILES, resolveWindowSize, type ProfileSet } from "./core/profiles";
import { renderDashboard, renderReport, type DashboardState } from "./core/render";
import { scanContext, type EditorInfo, type ScannerHost } from "./core/scanner";
import { suggest, totalTokens } from "./core/suggest";

const PIN_STATE_KEY = "contextFlow.pinnedIds";

class NodeScannerHost implements ScannerHost {
  workspaceRoot: string;
  constructor(root: string) {
    this.workspaceRoot = root;
  }
  readTextFile(p: string): string | null {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  }
  listFiles(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }
  exists(p: string): boolean {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  }
}

function cfg() {
  return vscode.workspace.getConfiguration("contextFlow");
}

function getProfiles(): ProfileSet {
  const raw = cfg().get<Record<string, unknown>>("profiles") ?? {};
  const out: ProfileSet = { ...DEFAULT_PROFILES };
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && v > 0) out[k] = v;
  }
  return out;
}

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : "";
}

function collectEditors(): EditorInfo[] {
  const out: EditorInfo[] = [];
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === input.uri.toString(),
        );
        const fsPath = input.uri.scheme === "file" ? input.uri.fsPath : input.uri.toString();
        out.push({
          path: fsPath,
          label: workspaceRelative(fsPath),
          chars: doc ? doc.getText().length : safeFileSize(fsPath),
          dirty: doc ? doc.isDirty : Boolean(tab.isDirty),
        });
      }
    }
  }
  return out;
}

function workspaceRelative(p: string): string {
  const root = workspaceRoot();
  if (root && p.startsWith(root)) return p.slice(root.length).replace(/^[\\/]/, "");
  return path.basename(p);
}

function safeFileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function selectionChars(): number {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return 0;
  let total = 0;
  for (const sel of editor.selections) {
    if (!sel.isEmpty) total += editor.document.getText(sel).length;
  }
  return total;
}

function buildState(pinnedIds: readonly string[]): DashboardState {
  const root = workspaceRoot();
  const host = new NodeScannerHost(root);
  const sources = scanContext(host, {
    editors: collectEditors(),
    selectionChars: selectionChars(),
    gitDiffChars: 0, // staged diff requires git; skipped to stay dependency-free and fast
    pinnedIds,
  });
  const classified = classifyAll(sources);
  const used = totalTokens(classified);
  const activeProfile = cfg().get<string>("activeProfile") ?? "claude-200k";
  const windowSize = resolveWindowSize(
    getProfiles(),
    activeProfile,
    cfg().get<number>("windowSize") ?? 200000,
  );
  const usage = computeUsage(activeProfile, windowSize, used);
  const suggestions = suggest({ sources: classified, windowSize, totalTokens: used });
  const cachedTokens = classified
    .filter((s) => s.likelyCached)
    .reduce((sum, s) => sum + s.tokens, 0);
  return { usage, sources: classified, suggestions, scannedAt: Date.now(), cachedTokens };
}

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let debounce: NodeJS.Timeout | undefined;

  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.command = "contextFlow.openDashboard";
  statusItem.show();
  context.subscriptions.push(statusItem);

  const getPinned = (): string[] =>
    context.globalState.get<string[]>(PIN_STATE_KEY) ?? [];

  function refresh(): void {
    const state = buildState(getPinned());
    const pct = Math.round(state.usage.usage * 100);
    const usedK = (state.usage.usedTokens / 1000).toFixed(1);
    statusItem.text = `$(pulse) ctx ${usedK}k (${pct}%)`;
    statusItem.tooltip = `Context Flow: ${state.usage.usedTokens} / ${state.usage.windowSize} tokens — ${state.usage.profile}`;
    statusItem.backgroundColor = state.usage.overBudget
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : undefined;
    if (panel) panel.webview.html = renderDashboard(state);
  }

  function scheduleRefresh(): void {
    if (debounce) clearTimeout(debounce);
    const ms = cfg().get<number>("refreshDebounceMs") ?? 500;
    debounce = setTimeout(refresh, ms);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("contextFlow.openDashboard", () => {
      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          "contextFlow.dashboard",
          "Context Flow",
          vscode.ViewColumn.Beside,
          { enableScripts: false, retainContextWhenHidden: true },
        );
        panel.onDidDispose(() => {
          panel = undefined;
        });
        context.subscriptions.push(panel);
      }
      panel.reveal(vscode.ViewColumn.Beside, true);
      refresh();
    }),
    vscode.commands.registerCommand("contextFlow.refresh", refresh),
    vscode.commands.registerCommand("contextFlow.copyReport", async () => {
      const report = renderReport(buildState(getPinned()));
      await vscode.env.clipboard.writeText(report);
      void vscode.window.showInformationMessage("Context Flow report copied to clipboard.");
    }),
    vscode.commands.registerCommand("contextFlow.setProfile", async () => {
      const profiles = getProfiles();
      const active = cfg().get<string>("activeProfile") ?? "";
      const pick = await vscode.window.showQuickPick(
        Object.entries(profiles).map(([name, size]) => ({
          label: name,
          description: `${(size / 1000).toFixed(0)}k tokens`,
          picked: name === active,
        })),
        { title: "Select model profile" },
      );
      if (pick) {
        await cfg().update("activeProfile", pick.label, vscode.ConfigurationTarget.Global);
        refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("contextFlow")) refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor(scheduleRefresh),
    vscode.window.onDidChangeTextEditorSelection(scheduleRefresh),
    vscode.workspace.onDidSaveTextDocument(scheduleRefresh),
    vscode.workspace.onDidChangeTextDocument(scheduleRefresh),
    vscode.window.tabGroups.onDidChangeTabs(scheduleRefresh),
  );

  refresh();
}

export function deactivate(): void {
  // Subscriptions are disposed by VS Code.
}
