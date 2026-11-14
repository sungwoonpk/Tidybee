import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { contradictions } from "../src/checks/contradictions.js";
import { makeRepo } from "./helpers.js";

type T = Parameters<typeof makeRepo>[0];
const run = (t: T, files: Record<string, string>) => contradictions(buildContext(makeRepo(t, files)));
const one = (t: T, text: string, file = "CLAUDE.md") => run(t, { [file]: text });

test("tabs in one place and spaces in another are a contradiction, and it says where and what", (t) => {
  const fs = one(t, "# Style\n\n- Indent with tabs.\n- Use 2 spaces for indentation.\n");
  assert.equal(fs.length, 1);
  assert.deepEqual(
    [fs[0]?.rule, fs[0]?.severity, fs[0]?.confidence, fs[0]?.line],
    ["contradiction", "warning", "medium", 4],
  );
  assert.equal(fs[0]?.subject, "indentation");
  assert.match(fs[0]?.message ?? "", /This says to indent with 2 spaces, and line 3 says to indent with tabs\./);
});

test("two numbers of spaces disagree, and 'spaces' alone does not disagree with a number", (t) => {
  assert.equal(one(t, "Indent with 2 spaces.\n\nIndent with 4 spaces.\n").length, 1);
  assert.equal(one(t, "Indent with spaces.\n\nIndent with 4 spaces.\n").length, 0);
  assert.equal(one(t, "Never use tabs for indentation.\n\nUse tabs.\n").length, 1, "'not tabs' means spaces");
  assert.equal(one(t, "Indent with 2 spaces.\n\nIndent with 2 spaces in every file.\n").length, 0);
});

test("a statement that names both sides, or has a condition, or is about another part, says nothing", (t) => {
  const text = [
    "- Use tabs or spaces, but not both.",
    "- Use tabs in Go files.",
    "- Python code is indented with 4 spaces.",
    "- Indent with 2 spaces when the file is YAML.",
    "- In the frontend, indent with 2 spaces.",
    "- Makefiles must use tabs for indentation.",
  ].join("\n");
  assert.deepEqual(one(t, text), []);
});

test("the same topic in the same part of the project is a contradiction, in another part it is not", (t) => {
  assert.equal(one(t, "- In Python, indent with 4 spaces.\n- In Python, indent with tabs.\n").length, 1);
  assert.equal(one(t, "- In Python, indent with 4 spaces.\n- In Go, indent with tabs.\n").length, 0);
});

test("line length, quotes, semicolons, trailing commas and the module system", (t) => {
  const cases: [string, string, RegExp][] = [
    [
      "Keep lines under 80 characters.\n\nThe maximum line length is 100 characters.\n",
      "line length",
      /keep lines to 100 characters, and line 1 says to keep lines to 80 characters/,
    ],
    [
      "Use single quotes.\n\nPrefer double quotes for strings.\n",
      "quotation marks",
      /use double quotes, and line 1 says to use single quotes/,
    ],
    ["Always use semicolons.\n\nNo semicolons.\n", "semicolons", /leave out semicolons/],
    [
      "Never use semicolons.\n\nUse semicolons at the end of every statement.\n",
      "semicolons",
      /end statements with semicolons/,
    ],
    ["Use trailing commas.\n\nDo not use trailing commas.\n", "trailing commas", /leave out trailing commas/],
    ["Use ES modules.\n\nUse CommonJS, with require() everywhere.\n", "the module system", /use CommonJS/],
  ];
  for (const [text, topic, message] of cases) {
    const fs = one(t, text);
    assert.equal(fs.length, 1, text);
    assert.equal(fs[0]?.subject, topic);
    assert.match(fs[0]?.message ?? "", message);
  }
  assert.deepEqual(one(t, "Keep lines under 80 characters.\n\nKeep commit messages under 72 characters.\n"), []);
  assert.deepEqual(one(t, "Use single quotes.\n\nUse single quotes in JavaScript, never double quotes.\n"), []);
});

test("the test runner and the formatter", (t) => {
  assert.equal(one(t, "Write tests with Jest.\n\nTests run with Vitest.\n").length, 1);
  assert.equal(one(t, "Use pytest.\n\nWrite tests with unittest.\n").length, 1);
  assert.equal(one(t, "Format with Prettier.\n\nFormat code with Biome.\n").length, 1);
  assert.deepEqual(one(t, "Use pytest and not unittest.\n\nWrite tests with pytest.\n"), []);
  assert.deepEqual(one(t, "Format with Prettier, lint with Biome.\n\nFormat with Prettier.\n"), []);
});

test("committing and pushing: 'as you go' against 'only when asked'", (t) => {
  const fs = one(t, "- Commit after every change.\n- Never commit unless I ask.\n");
  assert.equal(fs.length, 1);
  assert.match(fs[0]?.message ?? "", /commit only when asked, and line 1 says to commit without being asked/);
  assert.equal(one(t, "Push automatically after each commit.\n\nAsk me before you push.\n").length, 1);
  assert.equal(one(t, "Do not commit unless explicitly asked.\n\nOnly commit when I ask.\n").length, 0);
  assert.deepEqual(one(t, "Never commit secrets.\n\nCommit after every change.\n"), []);
});

test("a package manager in one place and another in another is a contradiction when no lockfile decides", (t) => {
  const fs = one(t, "# Setup\n\nInstall dependencies with `npm install`.\n\n```sh\nyarn dev\n```\n");
  assert.equal(fs.length, 1);
  assert.equal(fs[0]?.subject, "the package manager");
  assert.match(fs[0]?.message ?? "", /use yarn, and line 3 says to use npm/);
  assert.equal(one(t, "Use pnpm to install dependencies.\n\nInstall packages with bun.\n").length, 1);
});

test("a lockfile settles the package manager, and the other check reports the mismatch", (t) => {
  const fs = run(t, {
    "CLAUDE.md": "Run `npm install`.\n\nThen `pnpm dev`.\n",
    "pnpm-lock.yaml": "lockfileVersion: 9\n",
  });
  assert.deepEqual(fs, []);
});

test("a package manager that is named in order not to use it is no claim", (t) => {
  const text = [
    "Use pnpm instead of npm to install dependencies.",
    "",
    "Never use yarn to run scripts.",
    "",
    "Prefer pnpm over bun when you install packages.",
    "",
    "```sh",
    "pnpm install",
    "npm install -g typescript",
    "npx tsc",
    "```",
  ].join("\n");
  assert.deepEqual(one(t, text), []);
});

test("commands that run somewhere else, or only for one package, are left alone", (t) => {
  const text = [
    "```sh",
    "pnpm install",
    "cd website && npm install",
    "yarn --cwd docs install",
    "```",
    "",
    "Run `npm publish` to release.",
    "",
    "Don't use `yarn install`.",
  ].join("\n");
  assert.deepEqual(one(t, text), []);
});

test("only files that an agent reads together are compared", (t) => {
  const both = run(t, { "CLAUDE.md": "Indent with tabs.\n", "AGENTS.md": "Indent with 4 spaces.\n" });
  assert.equal(both.length, 1);
  assert.equal(both[0]?.file, "CLAUDE.md");
  assert.match(both[0]?.message ?? "", /line 1 of `AGENTS\.md`/);
  assert.equal(both[0]?.confidence, "medium");
  // A nested file is read only for work in its folder, so it may change what the root says.
  const nested = run(t, { "CLAUDE.md": "Indent with tabs.\n", "packages/a/AGENTS.md": "Indent with 4 spaces.\n" });
  assert.deepEqual(nested, []);
  // Two nested files in one folder are read together, and the reader is less sure.
  const sameFolder = run(t, { "a/CLAUDE.md": "Indent with tabs.\n", "a/AGENTS.md": "Indent with 4 spaces.\n" });
  assert.equal(sameFolder.length, 1);
  assert.equal(sameFolder[0]?.confidence, "low");
  // Rules for different files are not read together.
  const rules = run(t, {
    ".cursor/rules/a.mdc": "---\nglobs: src/**\n---\nIndent with tabs.\n",
    ".cursor/rules/b.mdc": "---\nglobs: docs/**\n---\nIndent with 4 spaces.\n",
  });
  assert.deepEqual(rules, []);
});

test("one contradiction is reported for a topic and a part of the project, not one for every pair", (t) => {
  const fs = one(t, "Indent with tabs.\n\nIndent with 2 spaces.\n\nIndent with 4 spaces.\n\nIndent with tabs.\n");
  assert.equal(fs.length, 1);
});

test("the check never throws on odd text", (t) => {
  assert.deepEqual(one(t, ""), []);
  assert.deepEqual(one(t, "# Only a heading\n"), []);
  assert.deepEqual(one(t, "use ".repeat(2000) + "tabs\n"), []);
});

// Each of these was a false positive on a real repository (VS Code's own instruction files), and is a test now.
test("a sentence that describes is not a rule", (t) => {
  assert.deepEqual(
    one(
      t,
      "bundle.ts holds the shared ESM options for the entries.\n\nStandalone CommonJS preloads do not use the banner.\n",
    ),
    [],
  );
  assert.deepEqual(one(t, "Tests use Mocha with the assert module.\n\nThe old suite ran on Jest.\n"), []);
});

test("a rule for one use of a thing is not a rule against another", (t) => {
  assert.deepEqual(
    one(t, '- `"double quotes"` for user-visible strings\n- Use single quotes for everything else.\n'),
    [],
  );
  assert.deepEqual(
    one(t, "Use double quotes for strings that are shown to the user.\n\nUse single quotes for all other strings.\n"),
    [],
  );
  assert.deepEqual(one(t, "Use single quotes.\n\nUse double quotes for user-facing text.\n"), []);
  // "for indentation" and "for all code" do not narrow a rule.
  assert.equal(one(t, "Use tabs for indentation.\n\nUse 2 spaces for all code.\n").length, 1);
});

test("a tool named as a comparison is not the tool chosen", (t) => {
  assert.deepEqual(one(t, "Use assertSnapshot for Jest-like snapshot tests.\n\nWrite tests with Mocha.\n"), []);
  assert.deepEqual(one(t, "Write tests with Mocha.\n\nUse snapshots like Jest does.\n"), []);
  assert.deepEqual(one(t, "Write tests with Mocha, similar to Jest.\n\nUse Mocha.\n"), []);
});
