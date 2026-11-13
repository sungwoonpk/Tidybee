import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext, alwaysTokens, loadModeOf } from "../src/analyze.js";
import { check } from "../src/engine.js";
import { parseMarkdown } from "../src/markdown.js";
import { estimateTokens } from "../src/tokens.js";
import { makeRepo } from "./helpers.js";

test("check reads a repository and returns findings in file and line order, with counts", (t) => {
  const root = makeRepo(
    t,
    {
      "package.json": JSON.stringify({ scripts: { build: "x" } }),
      "CLAUDE.md": "Line one.\nUse `src/gone.ts`.\n```\nnpm run nope\n```\n[bad](missing.md)\n",
      "AGENTS.md": "Fine.\n",
      "src/a.ts": "a",
    },
    { git: true },
  );
  const r = check(root);
  assert.deepEqual(
    r.findings.map((f) => `${f.file}:${f.line} ${f.rule}`),
    ["CLAUDE.md:2 stale-path", "CLAUDE.md:4 stale-command", "CLAUDE.md:6 stale-link"],
  );
  assert.deepEqual(r.counts, { error: 2, warning: 1, info: 0 });
  assert.equal(r.files.length, 2);
  assert.equal(r.usedGit, true);
  assert.equal(r.hidden, 0);
});

test("findings Tidybee is less sure of are hidden by default and counted, and shown on request", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "See `docs/api.md`.\n", "src/a.ts": "a" });
  const normal = check(root);
  assert.equal(normal.findings.length, 0);
  assert.equal(normal.hidden, 1);
  const all = check(root, { minConfidence: "low" });
  assert.deepEqual(
    all.findings.map((f) => f.severity),
    ["info"],
  );
  assert.equal(all.hidden, 0);
});

test("useGit: false is passed on, and says so in the report", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "x\n" }, { git: true });
  assert.equal(check(root, { useGit: false }).usedGit, false);
  assert.equal(check(root).usedGit, true);
});

test("a repository with no instruction files gives an empty report", (t) => {
  const root = makeRepo(t, { "src/a.ts": "a" });
  const r = check(root);
  assert.deepEqual([r.files.length, r.findings.length, r.alwaysLoadedTokens], [0, 0, 0]);
});

test("the tokens read at the start of every session count only the files an agent always loads", (t) => {
  const body = "Always follow the style guide and run the tests before you commit.\n".repeat(10);
  const root = makeRepo(t, {
    "CLAUDE.md": body,
    "AGENTS.md": body,
    "packages/web/AGENTS.md": body, // read only for work in that folder
    ".cursor/rules/always.mdc": `---\nalwaysApply: true\n---\n${body}`,
    ".cursor/rules/scoped.mdc": `---\nglobs: ["src/**"]\n---\n${body}`,
    ".cursor/rules/manual.mdc": `---\ndescription: manual\n---\n${body}`,
    ".claude/commands/review.md": body,
    ".claude/skills/pdf/SKILL.md": `---\nname: pdf\ndescription: Work with PDF files\n---\n${body}`,
    ".kiro/steering/a.md": body,
    ".kiro/steering/b.md": `---\ninclusion: manual\n---\n${body}`,
    ".windsurf/rules/a.md": `---\ntrigger: always_on\n---\n${body}`,
    ".windsurf/rules/b.md": `---\ntrigger: glob\n---\n${body}`,
  });
  const ctx = buildContext(root);
  const loads = Object.fromEntries(ctx.docs.map((d) => [d.file.path, d.load]));
  assert.deepEqual(loads, {
    "CLAUDE.md": "always",
    "AGENTS.md": "always",
    "packages/web/AGENTS.md": "on-demand",
    ".cursor/rules/always.mdc": "always",
    ".cursor/rules/scoped.mdc": "scoped",
    ".cursor/rules/manual.mdc": "on-demand",
    ".claude/commands/review.md": "on-demand",
    ".claude/skills/pdf/SKILL.md": "on-demand",
    ".kiro/steering/a.md": "always",
    ".kiro/steering/b.md": "on-demand",
    ".windsurf/rules/a.md": "always",
    ".windsurf/rules/b.md": "scoped",
  });
  const bodyTokens = (path: string) => ctx.docs.find((d) => d.file.path === path)?.tokens ?? 0;
  const expected =
    bodyTokens("CLAUDE.md") +
    bodyTokens("AGENTS.md") +
    bodyTokens(".cursor/rules/always.mdc") +
    bodyTokens(".kiro/steering/a.md") +
    bodyTokens(".windsurf/rules/a.md") +
    estimateTokens("pdf Work with PDF files");
  assert.equal(check(root).alwaysLoadedTokens, expected);
});

test("alwaysTokens: a skill costs its name and description only", (t) => {
  const root = makeRepo(t, {
    ".claude/skills/x/SKILL.md": `---\nname: x\ndescription: Does a thing\n---\n${"long body ".repeat(500)}`,
  });
  const [doc] = buildContext(root).docs;
  assert.ok(doc);
  assert.equal(alwaysTokens(doc), estimateTokens("x Does a thing"));
  assert.ok(doc.tokens > 500);
});

test("loadModeOf with no header falls back to the default for the kind", () => {
  const file = {
    path: ".cursor/rules/x.mdc",
    kind: "cursor-rule" as const,
    dir: ".cursor/rules",
    load: "scoped" as const,
  };
  assert.equal(loadModeOf(file, parseMarkdown("no header")), "on-demand");
  assert.equal(loadModeOf(file, parseMarkdown("---\nglobs:\n---\nx")), "on-demand");
  assert.equal(loadModeOf({ ...file, kind: "claude", load: "always" }, parseMarkdown("x")), "always");
});

test("a repository with far too many instruction files is checked only as far as the limit, and says so", (t) => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 503; i++) files[`pkg${String(i).padStart(3, "0")}/AGENTS.md`] = "Short note.\n";
  const r = check(makeRepo(t, files));
  assert.equal(r.files.length, 500);
  assert.equal(r.skippedFiles, 3);
});
