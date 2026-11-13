import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { parseTree, staleTrees } from "../src/checks/tree.js";
import { git, makeRepo } from "./helpers.js";

const run = (root: string) => staleTrees(buildContext(root));
const fenced = (body: string) => `Layout:\n\n\`\`\`\n${body}\n\`\`\`\n`;
const lines = (body: string) => body.split("\n").map((text, i) => ({ text, line: i + 1 }));
const summary = (fs: { rule: string; severity: string; subject?: string | undefined }[]) =>
  fs.map((f) => `${f.rule}/${f.severity}/${f.subject}`);

test("parseTree reads connectors, names, comments, name lists and the root line", () => {
  const t = parseTree(
    lines(
      ["proj/", "├── src/            # the code", "│   └── a.ts", "├── a.md / b.md", "└── Makefile, justfile"].join(
        "\n",
      ),
    ),
  );
  assert.equal(t?.root, "proj");
  assert.deepEqual(
    t?.entries.map((e) => [e.name, e.isDir, e.line]),
    [
      ["src", true, 2],
      ["a.ts", false, 3],
      ["a.md", false, 4],
      ["b.md", false, 4],
      ["Makefile", false, 5],
      ["justfile", false, 5],
    ],
  );
});

test("parseTree reads ASCII trees, and refuses a block that is not a tree", () => {
  assert.equal(parseTree(lines("|-- a\n|   `-- b\n`-- c"))?.entries.length, 3);
  assert.equal(parseTree(lines("+-- a\n+-- b"))?.entries.length, 2);
  assert.equal(parseTree(lines("just one\n├── a")), null, "one entry is not a tree");
  assert.equal(parseTree(lines("npm run build\nnpm test")), null);
});

test("the edge of a box in a diagram is not an entry, and a picture of a screen is not a tree", () => {
  const box = parseTree(lines("┌────────┐\n│ thing  │\n├── real.ts\n└──────┬─┘\n├──── Services ────┤\n├── other.ts"));
  assert.deepEqual(
    box?.entries.map((e) => e.name),
    ["real.ts", "other.ts"],
  );
  assert.equal(parseTree(lines("AI Customization (Tree View)\n├── Workspace\n└── User")), null);
});

test("an entry that is not in the repository is a medium-confidence warning, and one that is there is fine", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": fenced("proj/\n├── src/\n│   ├── a.ts\n│   └── gone.ts\n└── README.md"),
    "src/a.ts": "a",
    "README.md": "r",
  });
  const found = run(root);
  assert.deepEqual(summary(found), ["stale-tree/warning/src/gone.ts"]);
  assert.deepEqual([found[0]?.line, found[0]?.confidence], [7, "medium"]);
});

test("a folder that is gone is reported once and not again for everything in it", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": fenced(".\n├── old/\n│   ├── a.ts\n│   └── b.ts\n└── src/"),
    "src/x.ts": "x",
  });
  assert.deepEqual(summary(run(root)), ["stale-tree/warning/old"]);
});

test("Git turns a missing entry into a high-confidence error, with where it went", (t) => {
  const root = makeRepo(
    t,
    {
      "CLAUDE.md": fenced("proj/\n├── lib/\n│   └── util.ts\n└── src/"),
      "lib/util.ts": "u\n".repeat(8),
      "src/a.ts": "a",
    },
    { git: true },
  );
  git(root, "mv", "lib", "common");
  git(root, "commit", "-q", "-m", "rename");
  const [f] = run(root);
  assert.deepEqual([f?.rule, f?.severity, f?.confidence, f?.subject], ["stale-tree", "error", "high", "lib"]);
  assert.match(f?.message ?? "", /renamed to `common`/);
  assert.equal(f?.suggestion, "Write `common` instead.");
});

test("a first line that names the project, or a dot, means the entries are at the root", (t) => {
  const named = makeRepo(t, { "CLAUDE.md": fenced("some-project/\n├── a.ts\n└── b.ts"), "a.ts": "a", "b.ts": "b" });
  assert.deepEqual(run(named), []);
  const dot = makeRepo(t, { "CLAUDE.md": fenced(".\n├── a.ts\n└── b.ts"), "a.ts": "a", "b.ts": "b" });
  assert.deepEqual(run(dot), []);
});

test("a first line that is a folder means the entries are in it, wherever that folder is", (t) => {
  const inPath = makeRepo(t, {
    "CLAUDE.md": fenced("src/deep/ui/\n├── a.ts\n└── missing.ts"),
    "src/deep/ui/a.ts": "a",
  });
  assert.deepEqual(summary(run(inPath)), ["stale-tree/warning/src/deep/ui/missing.ts"]);
  const byName = makeRepo(t, {
    "CLAUDE.md": fenced("ui/\n├── a.ts\n└── b.ts"),
    "src/deep/ui/a.ts": "a",
    "src/deep/ui/b.ts": "b",
  });
  assert.deepEqual(run(byName), []);
});

test("when a folder name is used twice, the place where the entries really are is taken", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": fenced("tool/\n├── README.md\n├── INSTALL.md\n└── cli.ts"),
    "README.md": "r",
    "INSTALL.md": "i",
    "cli.ts": "c",
    "plugins/tool/README.md": "r",
    "skills/tool/x.md": "x",
  });
  assert.deepEqual(run(root), []);
});

test("entries are checked from the folder of a nested instruction file too", (t) => {
  const root = makeRepo(t, {
    "pkg/CLAUDE.md": fenced(".\n├── index.ts\n└── lib/"),
    "pkg/index.ts": "i",
    "pkg/lib/a.ts": "a",
  });
  assert.deepEqual(run(root), []);
});

test("build output, examples and ignored entries are left alone", (t) => {
  const root = makeRepo(
    t,
    {
      "CLAUDE.md": fenced(".\n├── dist/\n├── your-app/\n├── data.db\n├── <name>/\n├── *.log\n└── real.ts"),
      ".gitignore": "data.db\n",
      "real.ts": "r",
    },
    { git: true },
  );
  assert.deepEqual(run(root), []);
});

test("a block that is not a tree, such as a command or a diagram, is not read as one", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": fenced("npm run build\nnpm test") + fenced("┌──────┐\n│ box  │\n└──────┘") });
  assert.deepEqual(run(root), []);
});
