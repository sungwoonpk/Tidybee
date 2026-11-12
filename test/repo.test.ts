import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { discover } from "../src/discover.js";
import { loadHistory } from "../src/git.js";
import { indexRepo } from "../src/repo.js";
import { git, makeRepo, write } from "./helpers.js";

test("with Git the file list follows .gitignore and counts files not yet added", (t) => {
  const root = makeRepo(
    t,
    { ".gitignore": "secret.txt\nbuild/\n", "src/a.ts": "a", "secret.txt": "s", "build/out.js": "o" },
    { git: true },
  );
  write(root, { "src/new.ts": "n" });
  const index = indexRepo(root);
  assert.equal(index.usedGit, true);
  assert.deepEqual(index.files, [".gitignore", "src/a.ts", "src/new.ts"]);
});

test("a file removed from disk but still in the Git index is not listed", (t) => {
  const root = makeRepo(t, { "keep.md": "k", "gone.md": "g" }, { git: true });
  rmSync(join(root, "gone.md"));
  assert.deepEqual(indexRepo(root).files, ["keep.md"]);
});

test("without Git it walks the folder, skips build and dependency folders, and keeps hidden ones", (t) => {
  const root = makeRepo(t, {
    "a.md": "a",
    ".claude/x.md": "x",
    "node_modules/p/i.js": "i",
    "dist/o.js": "o",
    ".git/config": "c",
    "src/b.ts": "b",
  });
  const index = indexRepo(root);
  assert.equal(index.usedGit, false);
  assert.deepEqual(index.files, [".claude/x.md", "a.md", "src/b.ts"]);
});

test("useGit: false forces the walk even inside a repository", (t) => {
  const root = makeRepo(t, { ".gitignore": "ignored.txt\n", "ignored.txt": "i", "a.md": "a" }, { git: true });
  const index = indexRepo(root, { useGit: false });
  assert.equal(index.usedGit, false);
  assert.ok(index.files.includes("ignored.txt"));
});

test("lookups: files, folders, capitals, names anywhere, top level, and reading", (t) => {
  const root = makeRepo(t, { "src/util/Helper.ts": "export {}", "README.md": "hello" });
  const index = indexRepo(root);
  assert.ok(index.hasFile("src/util/Helper.ts"));
  assert.ok(!index.hasFile("src/util"));
  assert.ok(index.hasDir("src") && index.hasDir("src/util") && index.hasDir(""));
  assert.ok(!index.hasDir("lib"));
  assert.equal(index.caseMatch("src/util/helper.ts"), "src/util/Helper.ts");
  assert.equal(index.caseMatch("SRC/util"), "src/util");
  assert.equal(index.caseMatch("src/util/Helper.ts"), undefined);
  assert.equal(index.caseMatch("nothing.ts"), undefined);
  assert.deepEqual(index.byBasename("Helper.ts"), ["src/util/Helper.ts"]);
  assert.deepEqual(index.byBasename("missing.ts"), []);
  assert.ok(index.hasTopLevel("src") && index.hasTopLevel("README.md") && !index.hasTopLevel("docs"));
  assert.equal(index.read("README.md"), "hello");
});

test("a path that is not a folder is refused", (t) => {
  const root = makeRepo(t, { "a.md": "a" });
  assert.throws(() => indexRepo(join(root, "a.md")), /not a directory/);
  assert.throws(() => indexRepo(join(root, "nope")), /not a directory/);
});

test("history remembers deleted and renamed files and folders, newest event first", (t) => {
  const root = makeRepo(
    t,
    {
      "a/old.ts": "export const a = 1;\n".repeat(5),
      "c.md": "# c\n".repeat(5),
      "dir/x.ts": "x\n".repeat(5),
      "dir/y.ts": "y\n".repeat(5),
      "gone/z.ts": "z\n".repeat(5),
    },
    { git: true },
  );
  git(root, "mv", "a/old.ts", "a/new.ts");
  git(root, "commit", "-q", "-m", "rename a file");
  git(root, "rm", "-q", "c.md");
  git(root, "commit", "-q", "-m", "delete a file");
  git(root, "mv", "dir", "moved");
  git(root, "commit", "-q", "-m", "rename a folder");
  git(root, "rm", "-q", "-r", "gone");
  git(root, "commit", "-q", "-m", "delete a folder");

  const h = loadHistory(root);
  const renamed = h.lookup("a/old.ts");
  assert.equal(renamed?.kind, "renamed");
  assert.equal(renamed?.to, "a/new.ts");
  assert.match(renamed?.commit ?? "", /^[0-9a-f]{7,}$/);
  assert.match(renamed?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(h.lookup("c.md")?.kind, "deleted");
  assert.deepEqual([h.lookup("dir")?.kind, h.lookup("dir")?.to], ["renamed", "moved"]);
  assert.equal(h.lookup("gone")?.kind, "deleted");
  assert.equal(h.lookup("never/existed.ts"), undefined);
  assert.equal(h.lookup("a/new.ts"), undefined);
});

test("history without Git is empty", (t) => {
  const root = makeRepo(t, { "a.md": "a" });
  assert.equal(loadHistory(root).lookup("a.md"), undefined);
});

test("every kind of instruction file is found, with when an agent reads it", (t) => {
  const paths = [
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    "CONVENTIONS.md",
    ".cursorrules",
    ".windsurfrules",
    ".github/copilot-instructions.md",
    ".github/instructions/ts.instructions.md",
    ".cursor/rules/style.mdc",
    ".windsurf/rules/style.md",
    ".clinerules/style.md",
    ".claude/commands/review.md",
    ".claude/commands/team/ship.md",
    ".claude/agents/helper.md",
    ".claude/skills/pdf/SKILL.md",
    ".kiro/steering/product.md",
    "packages/web/AGENTS.md",
    "packages/web/CLAUDE.md",
    "README.md",
    "docs/CLAUDE.notes.md",
    ".github/workflows/ci.yml",
  ];
  const root = makeRepo(t, Object.fromEntries(paths.map((p) => [p, "x"])));
  const found = Object.fromEntries(discover(indexRepo(root)).map((f) => [f.path, `${f.kind}/${f.load}`]));
  assert.deepEqual(found, {
    "CLAUDE.md": "claude/always",
    "AGENTS.md": "agents/always",
    "GEMINI.md": "gemini/always",
    "CONVENTIONS.md": "conventions/always",
    ".cursorrules": "legacy-rules/always",
    ".windsurfrules": "legacy-rules/always",
    ".github/copilot-instructions.md": "copilot/always",
    ".github/instructions/ts.instructions.md": "copilot-scoped/scoped",
    ".cursor/rules/style.mdc": "cursor-rule/scoped",
    ".windsurf/rules/style.md": "windsurf-rule/scoped",
    ".clinerules/style.md": "cline-rule/always",
    ".claude/commands/review.md": "claude-command/on-demand",
    ".claude/commands/team/ship.md": "claude-command/on-demand",
    ".claude/agents/helper.md": "claude-agent/on-demand",
    ".claude/skills/pdf/SKILL.md": "skill/on-demand",
    ".kiro/steering/product.md": "steering/always",
    "packages/web/AGENTS.md": "agents/on-demand",
    "packages/web/CLAUDE.md": "claude/on-demand",
  });
  assert.equal(discover(indexRepo(root)).find((f) => f.path === "packages/web/AGENTS.md")?.dir, "packages/web");
});
