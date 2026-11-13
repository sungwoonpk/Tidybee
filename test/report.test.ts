import assert from "node:assert/strict";
import { test } from "node:test";
import type { Report } from "../src/engine.js";
import { renderJson, renderText } from "../src/report.js";

const base: Report = {
  root: "/r",
  usedGit: true,
  files: [{ path: "CLAUDE.md", kind: "claude", load: "always", tokens: 1200 }],
  findings: [],
  alwaysLoadedTokens: 1234,
  counts: { error: 0, warning: 0, info: 0 },
  skippedFiles: 0,
  hidden: 0,
};
// The escape character that starts a terminal color code.
const ESC = String.fromCharCode(27);
const plain = { color: false, showHiddenHint: true };

test("no instruction files: says what Tidybee looks for", () => {
  const text = renderText({ ...base, files: [] }, plain);
  assert.match(text, /^No instruction files found\. Tidybee looks for CLAUDE\.md, AGENTS\.md/);
  assert.ok(text.endsWith("\n"));
});

test("no problems: says so with the size of what is read every session", () => {
  assert.equal(
    renderText(base, plain),
    "No problems found in 1 instruction file, about 1,234 tokens read at the start of every session.\n",
  );
});

test("problems: grouped by file, with position, severity, message, rule, suggestion and a summary", () => {
  const r: Report = {
    ...base,
    files: [base.files[0]!, { path: "a/AGENTS.md", kind: "agents", load: "on-demand", tokens: 10 }],
    findings: [
      {
        rule: "stale-path",
        severity: "error",
        confidence: "high",
        file: "CLAUDE.md",
        line: 12,
        column: 5,
        message: "`x` is gone.",
        suggestion: "Use `y`.",
      },
      {
        rule: "stale-command",
        severity: "warning",
        confidence: "medium",
        file: "CLAUDE.md",
        line: 20,
        column: 1,
        message: "No such script.",
      },
      {
        rule: "stale-path",
        severity: "info",
        confidence: "low",
        file: "a/AGENTS.md",
        line: 3,
        column: 9,
        message: "Maybe gone.",
      },
    ],
    counts: { error: 1, warning: 1, info: 1 },
  };
  assert.equal(
    renderText(r, plain),
    [
      "CLAUDE.md",
      "  12:5    error   `x` is gone. stale-path",
      "          -> Use `y`.",
      "  20:1    warning No such script. stale-command",
      "",
      "a/AGENTS.md",
      "  3:9     info    Maybe gone. stale-path",
      "",
      "3 problems (1 error, 1 warning, 1 note) in 2 instruction files, about 1,234 tokens read at the start of every session.",
      "",
    ].join("\n"),
  );
});

test("one problem is singular, and a hidden-findings hint appears only when asked for and when there are some", () => {
  const one: Report = {
    ...base,
    findings: [
      { rule: "r", severity: "warning", confidence: "medium", file: "CLAUDE.md", line: 1, column: 1, message: "m" },
    ],
    counts: { error: 0, warning: 1, info: 0 },
    hidden: 3,
  };
  const text = renderText(one, plain);
  assert.match(text, /\n1 problem \(1 warning\) in 1 instruction file/);
  assert.match(text, /3 less certain findings not shown\. Run with --all to see them\./);
  assert.match(
    renderText({ ...one, hidden: 1 }, plain),
    /1 less certain finding not shown\. Run with --all to see it\./,
  );
  assert.doesNotMatch(renderText(one, { ...plain, showHiddenHint: false }), /not shown/);
  assert.doesNotMatch(renderText({ ...one, hidden: 0 }, plain), /not shown/);
});

test("it says when Git was not used", () => {
  assert.match(renderText({ ...base, usedGit: false }, plain), /Git was not used, so ignored files are not skipped/);
});

test("color is added only when asked for, and plain output has no escape codes", () => {
  const r: Report = {
    ...base,
    findings: [
      { rule: "r", severity: "error", confidence: "high", file: "CLAUDE.md", line: 1, column: 1, message: "m" },
    ],
    counts: { error: 1, warning: 0, info: 0 },
  };
  assert.ok(!renderText(r, plain).includes(ESC), "plain output has no color codes");
  assert.ok(renderText(r, { color: true, showHiddenHint: true }).includes(`${ESC}[31merror`));
  assert.ok(renderText(base, { color: true, showHiddenHint: true }).includes(`${ESC}[32mNo problems found${ESC}[0m`));
});

test("JSON carries a version and the whole report", () => {
  const parsed = JSON.parse(renderJson(base));
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.counts, base.counts);
  assert.equal(parsed.alwaysLoadedTokens, 1234);
  assert.deepEqual(parsed.files, base.files);
});

test("it says when instruction files were found beyond the limit and were not checked", () => {
  const text = renderText({ ...base, skippedFiles: 2500 }, plain);
  assert.match(text, /2,501 instruction files were found and only the first 1 were checked\./);
  assert.doesNotMatch(renderText(base, plain), /were found and only/);
});
