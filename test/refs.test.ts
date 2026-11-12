import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { candidatesIn, staleImports, staleLinks, stalePaths } from "../src/checks/refs.js";
import { git, makeRepo } from "./helpers.js";

const paths = (root: string) => stalePaths(buildContext(root));
const summary = (fs: { rule: string; severity: string; confidence: string; subject?: string | undefined }[]) =>
  fs.map((f) => `${f.rule}/${f.severity}/${f.confidence}/${f.subject}`);

test("a path under a folder that exists but with no such file is a medium-confidence warning", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "Edit `src/old.ts` and `src/new.ts`.\n", "src/new.ts": "x" });
  const found = paths(root);
  assert.deepEqual(summary(found), ["stale-path/warning/medium/src/old.ts"]);
  assert.deepEqual([found[0]?.file, found[0]?.line, found[0]?.column], ["CLAUDE.md", 1, 7]);
});

test("Git history turns a missing path into a high-confidence error, and a rename names where it went", (t) => {
  const root = makeRepo(
    t,
    {
      "CLAUDE.md": "See `src/old.ts` and `lib/gone.ts`.\n",
      "src/old.ts": "export const a = 1;\n".repeat(8),
      "lib/gone.ts": "g\n".repeat(8),
    },
    { git: true },
  );
  git(root, "mv", "src/old.ts", "src/renamed.ts");
  git(root, "commit", "-q", "-m", "rename");
  git(root, "rm", "-q", "lib/gone.ts");
  git(root, "commit", "-q", "-m", "delete");
  const found = paths(root);
  assert.deepEqual(summary(found), ["stale-path/error/high/src/old.ts", "stale-path/error/high/lib/gone.ts"]);
  assert.match(found[0]?.message ?? "", /renamed to `src\/renamed\.ts` in [0-9a-f]+ on \d{4}-\d{2}-\d{2}/);
  assert.equal(found[0]?.suggestion, "Point at `src/renamed.ts` instead.");
  assert.match(found[1]?.message ?? "", /deleted in [0-9a-f]+/);
  assert.equal(found[1]?.suggestion, undefined);
});

test("paths that exist are fine, from the root or from the file's own folder, and ./ and ../ follow the file", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": "`src/a.ts` and `docs/`.\n",
    "packages/web/AGENTS.md": "Use `components/Button.tsx`, `./local.ts`, `../shared/util.ts` and `src/a.ts`.\n",
    "src/a.ts": "a",
    "docs/x.md": "x",
    "packages/web/components/Button.tsx": "b",
    "packages/web/local.ts": "l",
    "packages/shared/util.ts": "u",
  });
  assert.deepEqual(paths(root), []);
});

test("a path that differs only in capitals is reported, with the real spelling", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "Open `src/Util.ts`.\n", "src/util.ts": "u" });
  const [f] = paths(root);
  assert.equal(f?.severity, "warning");
  assert.equal(f?.confidence, "high");
  assert.match(f?.message ?? "", /differs only in capitals from `src\/util\.ts`/);
  assert.equal(f?.suggestion, "Write `src/util.ts`.");
});

test("a path whose first folder is not in the repository is only a low-confidence note", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "See `docs/api.md`.\n", "src/a.ts": "a" });
  assert.deepEqual(summary(paths(root)), ["stale-path/info/low/docs/api.md"]);
});

test("a bare file name is reported only when Git remembers a file of that name that is gone", (t) => {
  const root = makeRepo(
    t,
    {
      "CLAUDE.md": "Read `tsconfig.json`, `settings.json` and `old.config.json`.\n",
      "old.config.json": "{}\n".repeat(5),
      "src/x.ts": "x",
    },
    { git: true },
  );
  git(root, "mv", "old.config.json", "src/moved.config.json");
  git(root, "commit", "-q", "-m", "move");
  const found = paths(root);
  assert.deepEqual(summary(found), ["stale-path/warning/medium/old.config.json"]);
  assert.match(found[0]?.message ?? "", /renamed to `src\/moved\.config\.json`/);
});

test("a bare name that exists somewhere in the repository is fine", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": "Edit `package.json` and `Button.tsx`.\n",
    "package.json": "{}",
    "a/b/Button.tsx": "b",
  });
  assert.deepEqual(paths(root), []);
});

test("things that look like paths and are not are left alone", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": [
      "Not files: `https://x.com/a/b.md`, `git@host:o/r.git`, `~/notes/a.md`, `/etc/hosts`, `@types/node`, `C:\\a\\b.md`.",
      "Patterns: `src/**/*.ts`, `docs/{a,b}.md`, `$HOME/x.md`, `go test ./pkg/...`, `--out=dist/app.js`.",
      "Names: `Node.js`, `.md`, `and/or`, `TCP/IP`, `.css` files.",
      "Examples: `path/to/file.ts`, `your-app/src/x.ts`, `foo/bar.ts`, `<name>/x.ts`.",
      "Test id: `tests/test_a.py::test_works`.",
      "Output: `dist/bundle.js`, `coverage/lcov.info`, `node_modules/x/index.js`.",
      "Line numbers: `src/a.ts:42` and `src/a.ts:42:7` and `src/a.ts#L10-L20`.",
    ].join("\n"),
    "src/a.ts": "a",
    "tests/test_a.py": "t",
  });
  assert.deepEqual(summary(paths(root)), []);
});

test("code blocks: shell blocks are read, other languages and tree drawings are not, and comments are skipped", (t) => {
  const md = [
    "```bash",
    "# edit src/commented.ts",
    "vim src/missing-in-shell.ts",
    "```",
    "```ts",
    'import x from "src/in-typescript.ts";',
    "```",
    "```",
    "src/",
    "├── tree-only.ts",
    "└── other.ts",
    "```",
  ].join("\n");
  const root = makeRepo(t, { "CLAUDE.md": md, "src/real.ts": "r" });
  assert.deepEqual(summary(paths(root)), ["stale-path/warning/medium/src/missing-in-shell.ts"]);
  assert.equal(paths(root)[0]?.line, 3);
});

test("a line that says it writes or installs a file names a target, not a file this repository needs", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": "The installer writes `.cursor/rules/x.mdc` into each repo.\nKeep `src/missing.ts` current.\n",
    "src/a.ts": "a",
  });
  assert.deepEqual(summary(paths(root)), ["stale-path/warning/medium/src/missing.ts"]);
});

test("a path ignored by .gitignore is not reported", (t) => {
  const root = makeRepo(
    t,
    {
      "CLAUDE.md": "Data is in `data/app.db` and `data/other.txt`.\n",
      ".gitignore": "data/app.db\n",
      "data/keep.txt": "k",
    },
    { git: true },
  );
  assert.deepEqual(summary(paths(root)), ["stale-path/warning/medium/data/other.txt"]);
});

test("the same path twice on a line is reported once", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "Use `src/gone.ts` or `src/gone.ts`.\n", "src/a.ts": "a" });
  assert.equal(paths(root).length, 1);
});

test("candidatesIn reads paths out of text", () => {
  const top = (s: string) => s === "src";
  assert.deepEqual(
    candidatesIn("run src/a.ts and src/util/", 3, 10, false, top).map((c) => [c.path, c.isDir, c.line, c.column]),
    [
      ["src/a.ts", false, 3, 14],
      ["src/util", true, 3, 27],
    ],
  );
  assert.deepEqual(candidatesIn("open <file> now", 1, 1, false, top), []);
  assert.equal(candidatesIn("package.json", 1, 1, false, top)[0]?.bare, true);
});

// Links

const links = (root: string) => staleLinks(buildContext(root));

test("a link to a file that is not there is a high-confidence error, with what Git remembers", (t) => {
  const root = makeRepo(
    t,
    {
      "README.md": "[a](docs/a.md) [b](docs/b.md) [c](https://x.com) [d](mailto:a@b.c)\n",
      "docs/b.md": "b\n".repeat(5),
    },
    { git: true },
  );
  git(root, "mv", "docs/b.md", "docs/c.md");
  git(root, "commit", "-q", "-m", "rename");
  // README.md is not an instruction file, so link it from CLAUDE.md instead.
  const root2 = makeRepo(
    t,
    {
      "CLAUDE.md": "[a](docs/a.md) [b](docs/b.md) [c](https://x.com) [d](mailto:a@b.c)\n",
      "docs/b.md": "b\n".repeat(5),
    },
    { git: true },
  );
  git(root2, "mv", "docs/b.md", "docs/c.md");
  git(root2, "commit", "-q", "-m", "rename");
  const found = links(root2);
  assert.deepEqual(summary(found), ["stale-link/error/high/docs/a.md", "stale-link/error/high/docs/b.md"]);
  assert.match(found[1]?.message ?? "", /renamed to `docs\/c\.md`/);
  assert.equal(found[1]?.suggestion, "Point at `docs/c.md` instead.");
  assert.equal(links(root).length, 0, "no instruction file in the first repository");
});

test("links resolve from the file's folder, or from the root when they start with a slash, and ignore the query", (t) => {
  const root = makeRepo(t, {
    "docs/CLAUDE.md": "[a](a.md) [b](../top.md?plain=1) [c](/top.md) [d](a%20b.md) [e](sub/)\n",
    "docs/a.md": "a",
    "docs/a b.md": "ab",
    "docs/sub/x.md": "x",
    "top.md": "t",
  });
  assert.deepEqual(links(root), []);
});

test("anchors are checked in the same file and in other Markdown files, with GitHub's numbering for repeats", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": [
      "# Setup",
      "## Notes",
      "## Notes",
      "[ok](#setup) [bad](#nope) [dup](#notes-1) [dup2](#notes-2)",
      "[ok2](docs/a.md#build-it) [bad2](docs/a.md#missing) [enc](docs/a.md#Build-It) [space](docs/a.md#Build%20It)",
    ].join("\n"),
    "docs/a.md": "# Build it\ntext\n",
  });
  const found = links(root);
  assert.deepEqual(summary(found), [
    "stale-anchor/warning/medium/#nope",
    "stale-anchor/warning/medium/#notes-2",
    "stale-anchor/warning/medium/docs/a.md#missing",
    "stale-anchor/warning/medium/docs/a.md#Build%20It",
  ]);
});

test("a link to a path that .gitignore covers is not reported", (t) => {
  const root = makeRepo(
    t,
    { "CLAUDE.md": "[build](dist/out.md) [gone](gone.md)\n", ".gitignore": "dist/\n" },
    { git: true },
  );
  assert.deepEqual(summary(links(root)), ["stale-link/error/high/gone.md"]);
});

// Imports

const imports = (root: string) => staleImports(buildContext(root));

test("an @import of a file that is not there is an error, and one that is there is fine", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": "@docs/rules.md\n@docs/missing.md\n@~/my/own.md\n",
    "docs/rules.md": "rules",
  });
  assert.deepEqual(summary(imports(root)), ["stale-import/error/high/@docs/missing.md"]);
});

test("imports follow imports, and a loop is reported once", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "@a.md\n", "a.md": "@b.md\n", "b.md": "@a.md\n" });
  const found = imports(root);
  assert.deepEqual(summary(found), ["import-cycle/warning/high/@a.md"]);
  assert.equal(found[0]?.file, "b.md");
});

test("imports nested deeper than five are reported where they go too deep", (t) => {
  const files: Record<string, string> = { "CLAUDE.md": "@l1.md\n" };
  for (let i = 1; i <= 6; i++) files[`l${i}.md`] = i < 6 ? `@l${i + 1}.md\n` : "end\n";
  const root = makeRepo(t, files);
  const found = imports(root);
  assert.deepEqual(summary(found), ["import-depth/warning/high/@l6.md"]);
  assert.equal(found[0]?.file, "l5.md");
  const shallow = makeRepo(t, { "CLAUDE.md": "@l1.md\n", "l1.md": "@l2.md\n", "l2.md": "end\n" });
  assert.deepEqual(imports(shallow), []);
});

test("only files that read imports are checked: AGENTS.md and rules do not", (t) => {
  const root = makeRepo(t, {
    "AGENTS.md": "@gone.md\n",
    ".cursor/rules/x.mdc": "@gone.md\n",
    "GEMINI.md": "@gone.md\n",
  });
  assert.deepEqual(
    imports(root).map((f) => f.file),
    ["GEMINI.md"],
  );
});

test("a missing import tells where Git saw the file go", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "@docs/old.md\n", "docs/old.md": "o\n".repeat(8) }, { git: true });
  git(root, "mv", "docs/old.md", "docs/new.md");
  git(root, "commit", "-q", "-m", "rename");
  const [f] = imports(root);
  assert.match(f?.message ?? "", /renamed to `docs\/new\.md`/);
  assert.equal(f?.suggestion, "Import `docs/new.md` instead.");
});
