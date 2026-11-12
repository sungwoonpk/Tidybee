import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { commandsIn, scriptOf, staleCommands } from "../src/checks/commands.js";
import { justRecipesOf, makeTargetsOf, readProject } from "../src/project.js";
import { indexRepo } from "../src/repo.js";
import { makeRepo } from "./helpers.js";

const run = (root: string) => staleCommands(buildContext(root));
const summary = (fs: { rule: string; severity: string; confidence: string; subject?: string | undefined }[]) =>
  fs.map((f) => `${f.rule}/${f.severity}/${f.confidence}/${f.subject}`);
const pkg = (scripts: Record<string, string>, extra: object = {}) => JSON.stringify({ name: "x", scripts, ...extra });

test("commandsIn drops the prompt, comments, variable settings and sudo, and splits on && ; and pipes", () => {
  assert.deepEqual(commandsIn("$ FOO=1 BAR=2 npm run build && npm test | tee out; make lint # then relax"), [
    ["npm", "run", "build"],
    ["npm", "test"],
    ["tee", "out"],
    ["make", "lint"],
  ]);
  assert.deepEqual(commandsIn("sudo time make install"), [["make", "install"]]);
  assert.deepEqual(commandsIn("   "), []);
});

test("scriptOf: which word names a script", () => {
  assert.deepEqual(scriptOf("npm", ["run", "build"]), { script: "build", viaRun: true });
  assert.deepEqual(scriptOf("npm", ["run-script", "-s", "lint"]), { script: "lint", viaRun: true });
  assert.deepEqual(scriptOf("npm", ["test"]), { script: "test", viaRun: false });
  assert.deepEqual(scriptOf("npm", ["start"]), { script: "start", viaRun: false });
  assert.equal(scriptOf("npm", ["install"]), null);
  assert.equal(scriptOf("npm", ["build"]), null, "npm does not run a script without run");
  assert.deepEqual(scriptOf("pnpm", ["build"]), { script: "build", viaRun: false });
  assert.deepEqual(scriptOf("yarn", ["lint", "--fix"]), { script: "lint", viaRun: false });
  assert.equal(scriptOf("pnpm", ["install"]), null);
  assert.equal(scriptOf("yarn", ["add", "x"]), null);
  assert.equal(scriptOf("pnpm", ["dlx", "x"]), null);
  assert.equal(scriptOf("bun", ["test"]), null, "bun test is bun's own test runner");
  assert.equal(scriptOf("bun", ["install"]), null);
  assert.deepEqual(scriptOf("bun", ["run", "dev"]), { script: "dev", viaRun: true });
  assert.equal(scriptOf("pnpm", ["./scripts/x.js"]), null);
  assert.equal(
    scriptOf("pnpm", ["--filter", "web", "build"]),
    null,
    "a scoped command is not checked against every script",
  );
  assert.equal(scriptOf("npm", ["run", "build", "--workspace=a"]), null);
  assert.equal(scriptOf("npm", []), null);
  assert.equal(scriptOf("npm", ["run"]), null);
});

test("a script that no package.json defines is an error in a code block and a warning in a code span", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({ build: "tsc", test: "node --test" }),
    "CLAUDE.md": "Run `npm run lint` before you push.\n```bash\nnpm run build\nnpm run deploy\n```\n",
  });
  assert.deepEqual(summary(run(root)), [
    "stale-command/warning/medium/npm run lint",
    "stale-command/error/high/npm run deploy",
  ]);
});

test("a script defined in any package.json of a monorepo counts", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({}),
    "packages/web/package.json": pkg({ storybook: "sb" }),
    "CLAUDE.md": "```\nnpm run storybook\n```\n",
  });
  assert.deepEqual(run(root), []);
});

test("npm test needs a test script, and npm start is fine with a server.js", (t) => {
  const a = makeRepo(t, { "package.json": pkg({ build: "x" }), "CLAUDE.md": "```\nnpm test\nnpm start\n```\n" });
  assert.deepEqual(summary(run(a)), ["stale-command/error/high/npm test", "stale-command/error/high/npm start"]);
  const b = makeRepo(t, { "package.json": pkg({}), "server.js": "x", "CLAUDE.md": "```\nnpm start\n```\n" });
  assert.deepEqual(run(b), []);
});

test("pnpm and yarn run scripts by name, and their own commands are left alone", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({ build: "x" }, { packageManager: "pnpm@9.0.0" }),
    "CLAUDE.md": "```\npnpm build\npnpm install\npnpm add left-pad\npnpm dlx create-x\npnpm typo\n```\n",
  });
  assert.deepEqual(summary(run(root)), ["stale-command/error/high/pnpm typo"]);
});

test("a repository with no package.json cannot run a node script", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "```\nnpm run build\n```\n", "main.py": "x" });
  const [f] = run(root);
  assert.match(f?.message ?? "", /no package\.json/);
});

test("global installs and scoped commands are not checked", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({ build: "x" }),
    "pnpm-lock.yaml": "",
    "CLAUDE.md": "```\nnpm install -g pnpm\npnpm --filter web nope\npnpm run nope --workspace=a\n```\n",
  });
  assert.deepEqual(run(root), []);
});

test("using a package manager the repository does not use is one warning for each, naming the other lines", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({ build: "x", test: "y" }),
    "pnpm-lock.yaml": "",
    "CLAUDE.md": "```\nnpm install\npnpm install\nnpm run build\nyarn test\nnpx tsc\n```\n",
  });
  const found = run(root);
  assert.deepEqual(summary(found), [
    "package-manager/warning/high/npm install",
    "package-manager/warning/high/yarn test",
  ]);
  assert.equal(found[0]?.message, "Uses npm, but this repository's lockfile is pnpm's. The same on line 4.");
  assert.equal(found[0]?.suggestion, "Use pnpm.");
  assert.doesNotMatch(found[1]?.message ?? "", /The same on/);
});

test("a wrong package manager does not hide a script that is missing", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({ build: "x" }),
    "pnpm-lock.yaml": "",
    "CLAUDE.md": "```\nnpm run lint\n```\n",
  });
  assert.deepEqual(summary(run(root)).sort(), [
    "package-manager/warning/high/npm run lint",
    "stale-command/error/high/npm run lint",
  ]);
});

test("with no lockfile there is no manager to disagree with, and the nearest lockfile wins in a monorepo", (t) => {
  const none = makeRepo(t, {
    "package.json": pkg({ build: "x" }),
    "CLAUDE.md": "```\nyarn build\nnpm run build\n```\n",
  });
  assert.deepEqual(run(none), []);
  const mono = makeRepo(t, {
    "package.json": pkg({ build: "x" }),
    "package-lock.json": "{}",
    "apps/web/package.json": pkg({ build: "x" }),
    "apps/web/yarn.lock": "",
    "apps/web/CLAUDE.md": "```\nyarn build\nnpm run build\n```\n",
  });
  assert.deepEqual(summary(run(mono)), ["package-manager/warning/high/npm run build"]);
});

test("make: a missing target, a missing Makefile, and what is skipped", (t) => {
  const root = makeRepo(t, {
    Makefile: ".PHONY: build test\nbuild:\n\techo b\ntest lint:\n\techo t\nCC := gcc\n%.o: %.c\n\techo o\n",
    "CLAUDE.md":
      "```\nmake\nmake build\nmake lint\nmake deploy\nmake build DEBUG=1\nmake -C sub nothing\nmake -f other.mk x\n```\n",
  });
  assert.deepEqual(summary(run(root)), ["stale-command/error/high/make deploy"]);
  const none = makeRepo(t, { "CLAUDE.md": "```\nmake build\n```\n" });
  assert.match(run(none)[0]?.message ?? "", /needs a Makefile, and this repository has none/);
});

test("just: a missing recipe and a missing justfile", (t) => {
  const root = makeRepo(t, {
    justfile: "default:\n  echo\n\nbuild target='x':\n  echo\n@quiet:\n  echo\n",
    "CLAUDE.md": "```\njust build\njust quiet\njust nope\njust\n```\n",
  });
  assert.deepEqual(summary(run(root)), ["stale-command/error/high/just nope"]);
  const none = makeRepo(t, { "CLAUDE.md": "```\njust build\n```\n" });
  assert.match(run(none)[0]?.message ?? "", /needs a justfile/);
});

test("templates with placeholders, comments and other languages are not read as commands", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({}),
    "CLAUDE.md": "Use `npm run <script>`.\n```bash\n# npm run commented\n```\n```js\nnpm run in javascript\n```\n",
  });
  assert.deepEqual(run(root), []);
});

test("the same command twice on a line is reported once", (t) => {
  const root = makeRepo(t, { "package.json": pkg({}), "CLAUDE.md": "`npm run x` and `npm run x`\n" });
  assert.equal(run(root).length, 1);
});

// The project reader

test("makeTargetsOf finds targets, including several on one line, and skips rules that are not targets", () => {
  assert.deepEqual(
    makeTargetsOf("all test: dep\nCC:=gcc\n%.o: %.c\nVAR ?= 1\nweird::\nfoo/bar.txt: x\n.PHONY: all\n"),
    ["all", "test", "foo/bar.txt"],
  );
});

test("justRecipesOf finds recipes with parameters and the quiet marker", () => {
  assert.deepEqual(
    justRecipesOf("set shell := ['bash']\nfoo:\n  x\nbar arg='1': foo\n  y\n@baz:\n  z\nname := 'x'\n"),
    ["foo", "bar", "baz"],
  );
});

test("readProject: scripts, build files, package manager from a lockfile or the packageManager field, bad JSON ignored", (t) => {
  const root = makeRepo(t, {
    "package.json": pkg({ a: "1" }, { packageManager: "yarn@4.0.0" }),
    "packages/x/package.json": "{ not json",
    "packages/y/package.json": pkg({ b: "2" }),
    "packages/y/bun.lockb": "",
    "sub/Makefile": "t:\n",
    "sub/justfile": "j:\n",
  });
  const p = readProject(indexRepo(root));
  assert.deepEqual([...p.scripts].sort(), ["a", "b"]);
  assert.ok(p.hasPackageJson && p.hasMakefile && p.hasJustfile);
  assert.ok(p.makeTargets.has("t") && p.justRecipes.has("j"));
  assert.equal(p.managerFor(""), "yarn");
  assert.equal(p.managerFor("packages/y/src"), "bun");
  assert.equal(p.managerFor("sub"), "yarn");
  assert.equal(readProject(indexRepo(makeRepo(t, { "a.md": "x" }))).managerFor("x/y"), undefined);
});
