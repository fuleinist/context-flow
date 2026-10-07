// Unit tests over the pure core modules (AC2-AC6, AC8).
// Runs against compiled output in out/core — run `npm run compile` first.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const tokens = require("../out/core/tokens.js");
const scanner = require("../out/core/scanner.js");
const cache = require("../out/core/cache.js");
const suggest = require("../out/core/suggest.js");
const profiles = require("../out/core/profiles.js");
const render = require("../out/core/render.js");

// ---------- F4 / AC3: token estimator ----------

test("estimator within +/-20% of 4-chars-per-token baseline on English prose", () => {
  const prose =
    "The quick brown fox jumps over the lazy dog. ".repeat(20) +
    "Context window management is a common frustration for developers who use AI coding assistants every day.";
  const baseline = prose.length / 4;
  const est = tokens.estimateTokens(prose);
  assert.ok(
    Math.abs(est - baseline) / baseline <= 0.2,
    `prose estimate ${est} vs baseline ${baseline.toFixed(1)}`,
  );
});

test("estimator within +/-20% of 4-chars-per-token baseline on code", () => {
  const code = [
    "function computeUsage(profile, windowSize, usedTokens) {",
    "  const w = windowSize > 0 ? windowSize : 1;",
    "  const usage = usedTokens / w;",
    "  return { profile, windowSize, usedTokens, usage, overBudget: usage > 1 };",
    "}",
  ].join("\n").repeat(4);
  const baseline = code.length / 4;
  const est = tokens.estimateTokens(code);
  assert.ok(
    Math.abs(est - baseline) / baseline <= 0.2,
    `code estimate ${est} vs baseline ${baseline.toFixed(1)}`,
  );
  assert.equal(tokens.classifyContent(code), "code");
});

test("estimator handles empty text and CJK", () => {
  assert.equal(tokens.estimateTokens(""), 0);
  assert.equal(tokens.classifyContent("这是一个测试文本用于验证中日韩文字的标记估算是否合理准确"), "cjk");
  const cjkTokens = tokens.estimateTokens("这是一个测试文本用于验证中日韩文字的标记估算");
  assert.ok(cjkTokens > "这是一个测试文本用于验证中日韩文字的标记估算".length / 4);
});

// ---------- F3 / AC4: scanner ----------

function fixtureHost(files) {
  // files: map of relative path -> content
  const norm = (p) => p.replace(/\\/g, "/");
  return {
    workspaceRoot: "/ws",
    readTextFile(p) {
      const rel = norm(p).replace(/^\/ws\//, "");
      return Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null;
    },
    listFiles(dir) {
      const d = norm(dir).replace(/^\/ws\//, "") + "/";
      const out = [];
      for (const rel of Object.keys(files)) {
        if (rel.startsWith(d) && !rel.slice(d.length).includes("/")) {
          out.push(rel.slice(d.length));
        }
      }
      return out;
    },
    exists(p) {
      const rel = norm(p).replace(/^\/ws\//, "");
      if (Object.prototype.hasOwnProperty.call(files, rel)) return true;
      const d = rel.endsWith("/") ? rel : rel + "/";
      return Object.keys(files).some((k) => k.startsWith(d));
    },
  };
}

test("scanner finds rules files in a fixture workspace (AC4)", () => {
  const host = fixtureHost({
    "AGENTS.md": "# Agents rules\n".repeat(30),
    ".cursorrules": "always be concise",
    ".cursor/rules/style.mdc": "no semicolons",
    ".cursor/rules/ignoreme.png": "binary",
    "src/main.ts": "console.log(1)",
  });
  const sources = scanner.scanRulesFiles(host);
  const labels = sources.map((s) => s.label).sort();
  assert.deepEqual(labels, [".cursor/rules/style.mdc", ".cursorrules", "AGENTS.md"]);
  for (const s of sources) {
    assert.ok(s.tokens > 0, `${s.label} tokens`);
    assert.ok(s.chars > 0, `${s.label} chars`);
    assert.equal(s.kind, "rules");
  }
  const agents = sources.find((s) => s.label === "AGENTS.md");
  assert.equal(agents.chars, "# Agents rules\n".repeat(30).length);
});

test("scanContext merges editors, selection, diff and pins", () => {
  const host = fixtureHost({ "CLAUDE.md": "be terse" });
  const sources = scanner.scanContext(host, {
    editors: [
      { path: "/ws/src/a.ts", label: "src/a.ts", chars: 1200, dirty: true },
      { path: "/ws/src/b.ts", label: "src/b.ts", chars: 800, dirty: false, pinned: true },
    ],
    selectionChars: 240,
    gitDiffChars: 500,
    pinnedIds: ["rules:CLAUDE.md"],
  });
  const ids = sources.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    "editor:/ws/src/a.ts",
    "editor:/ws/src/b.ts",
    "git-diff",
    "rules:CLAUDE.md",
    "selection",
  ]);
  assert.equal(sources.find((s) => s.id === "rules:CLAUDE.md").pinned, true);
  assert.equal(sources.find((s) => s.id === "editor:/ws/src/b.ts").pinned, true);
});

test("scanContext: zero-size selection and diff produce no sources", () => {
  const host = fixtureHost({});
  const sources = scanner.scanContext(host, { selectionChars: 0, gitDiffChars: 0 });
  assert.deepEqual(sources, []);
});

// ---------- F5 / AC5: cache classifier ----------

test("classifier is deterministic for identical inputs (AC5)", () => {
  const src = {
    id: "rules:AGENTS.md",
    kind: "rules",
    label: "AGENTS.md",
    chars: 100,
    tokens: 25,
    dirty: false,
    pinned: false,
  };
  const a = cache.classifyAll([src]);
  const b = cache.classifyAll([src]);
  assert.deepEqual(a, b);
  assert.equal(a[0].stability, "stable");
  assert.equal(a[0].likelyCached, true);
});

test("classifier labels dirty editors volatile, clean editors semi-stable", () => {
  const mk = (dirty) => ({
    id: `editor:${dirty}`,
    kind: "open-editor",
    label: "f.ts",
    chars: 10,
    tokens: 3,
    dirty,
    pinned: false,
  });
  const [vol, semi] = cache.classifyAll([mk(true), mk(false)]);
  assert.equal(vol.stability, "volatile");
  assert.equal(vol.likelyCached, false);
  assert.equal(semi.stability, "semi-stable");
  assert.equal(semi.likelyCached, true);
  const [sel] = cache.classifyAll([
    { id: "selection", kind: "selection", label: "sel", chars: 10, tokens: 3, dirty: true, pinned: false },
  ]);
  assert.equal(sel.stability, "volatile");
});

// ---------- F6 / AC6: suggestions ----------

function cls(over) {
  return cache.classifyAll([over]);
}

test("every suggestion includes a token delta; pinned sources are never removed (AC6)", () => {
  const pinnedVolatile = {
    id: "selection",
    kind: "selection",
    label: "Active selection",
    chars: 40000,
    tokens: 10000,
    dirty: true,
    pinned: true,
  };
  const [c] = cls(pinnedVolatile);
  const suggestions = suggest.suggest({
    sources: [c],
    windowSize: 10000,
    totalTokens: 10000, // 100% usage -> would normally suggest removal
  });
  assert.ok(
    !suggestions.some((s) => s.action === "remove" && s.sourceId === "selection"),
    "pinned source must not be suggested for removal",
  );
  for (const s of suggestions) {
    assert.equal(typeof s.tokenDelta, "number");
  }
});

test("high usage suggests removing volatile unpinned sources with negative delta", () => {
  const volatile = {
    id: "git-diff",
    kind: "git-diff",
    label: "Staged git diff",
    chars: 20000,
    tokens: 5000,
    dirty: true,
    pinned: false,
  };
  const [c] = cls(volatile);
  const suggestions = suggest.suggest({
    sources: [c],
    windowSize: 10000,
    totalTokens: 9000, // 90% usage
  });
  const rm = suggestions.find((s) => s.action === "remove" && s.sourceId === "git-diff");
  assert.ok(rm, "expected a remove suggestion");
  assert.equal(rm.tokenDelta, -5000);
});

test("oversized rules file gets a trim suggestion, not a remove", () => {
  const rules = {
    id: "rules:AGENTS.md",
    kind: "rules",
    label: "AGENTS.md",
    chars: 120000,
    tokens: 30000,
    dirty: false,
    pinned: false,
  };
  const [c] = cls(rules);
  const suggestions = suggest.suggest({
    sources: [c],
    windowSize: 100000,
    totalTokens: 30000,
  });
  assert.equal(suggestions[0].action, "trim");
  assert.ok(suggestions[0].tokenDelta < 0);
  assert.ok(!suggestions.some((s) => s.action === "remove" && s.sourceId === "rules:AGENTS.md"));
});

test("low usage suggests adding candidates that are not already included", () => {
  const small = {
    id: "editor:a.ts",
    kind: "open-editor",
    label: "a.ts",
    chars: 400,
    tokens: 100,
    dirty: false,
    pinned: false,
  };
  const [c] = cls(small);
  const suggestions = suggest.suggest({
    sources: [c],
    windowSize: 200000,
    totalTokens: 100,
    addCandidates: [
      { id: "editor:a.ts", label: "a.ts", tokens: 100 }, // already present -> skipped
      { id: "editor:b.ts", label: "b.ts", tokens: 500 },
    ],
  });
  const adds = suggestions.filter((s) => s.action === "add");
  assert.equal(adds.length, 1);
  assert.equal(adds[0].sourceId, "editor:b.ts");
  assert.equal(adds[0].tokenDelta, 500);
});

test("totalTokens sums source tokens", () => {
  const sources = [
    { id: "a", kind: "rules", label: "a", chars: 0, tokens: 10, dirty: false, pinned: false },
    { id: "b", kind: "rules", label: "b", chars: 0, tokens: 32, dirty: false, pinned: false },
  ];
  assert.equal(suggest.totalTokens(sources), 42);
});

// ---------- F7: profiles ----------

test("resolveWindowSize falls back when profile is unknown", () => {
  assert.equal(profiles.resolveWindowSize({ a: 5000 }, "a", 999), 5000);
  assert.equal(profiles.resolveWindowSize({ a: 5000 }, "missing", 999), 999);
  assert.equal(profiles.resolveWindowSize({}, "missing", 0), 200000);
});

test("computeUsage flags over-budget", () => {
  const u = profiles.computeUsage("p", 1000, 1500);
  assert.equal(u.overBudget, true);
  assert.ok(Math.abs(u.usage - 1.5) < 1e-9);
  const ok = profiles.computeUsage("p", 1000, 250);
  assert.equal(ok.overBudget, false);
});

// ---------- F1/AC8: renderer ----------

test("renderDashboard returns a full HTML document from state (AC8)", () => {
  const sources = cache.classifyAll([
    { id: "rules:AGENTS.md", kind: "rules", label: "AGENTS.md", chars: 4000, tokens: 1000, dirty: false, pinned: true },
    { id: "selection", kind: "selection", label: "Active selection", chars: 800, tokens: 210, dirty: true, pinned: false },
  ]);
  const state = {
    usage: profiles.computeUsage("claude-200k", 200000, 1210),
    sources,
    suggestions: [
      { action: "remove", sourceId: "selection", label: "Remove Active selection", reason: "volatile", tokenDelta: -210, priority: 80 },
    ],
    scannedAt: 1760000000000,
    cachedTokens: 1000,
  };
  const html = render.renderDashboard(state);
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("Context Flow"));
  assert.ok(html.includes("AGENTS.md"));
  assert.ok(html.includes("Active selection"));
  assert.ok(html.includes("stable"));
  assert.ok(html.includes("volatile"));
  // Deterministic: same state renders the same HTML.
  assert.equal(html, render.renderDashboard(state));
});

test("renderDashboard escapes HTML in labels", () => {
  const sources = cache.classifyAll([
    { id: "x", kind: "rules", label: "<script>alert(1)</script>", chars: 10, tokens: 3, dirty: false, pinned: false },
  ]);
  const html = render.renderDashboard({
    usage: profiles.computeUsage("p", 1000, 3),
    sources,
    suggestions: [],
    scannedAt: 0,
    cachedTokens: 3,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderReport produces a markdown snapshot (F9)", () => {
  const md = render.renderReport({
    usage: profiles.computeUsage("gpt-128k", 128000, 64000),
    sources: cache.classifyAll([
      { id: "rules:CLAUDE.md", kind: "rules", label: "CLAUDE.md", chars: 400, tokens: 100, dirty: false, pinned: false },
    ]),
    suggestions: [
      { action: "trim", sourceId: "rules:CLAUDE.md", label: "Trim CLAUDE.md", reason: "oversized", tokenDelta: -50, priority: 90 },
    ],
    scannedAt: 1760000000000,
    cachedTokens: 100,
  });
  assert.ok(md.includes("# Context Flow report"));
  assert.ok(md.includes("gpt-128k"));
  assert.ok(md.includes("50%"));
  assert.ok(md.includes("| CLAUDE.md | rules | stable, cached | 100 |"));
  assert.ok(md.includes("**trim** Trim CLAUDE.md"));
});
