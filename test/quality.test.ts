import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { quality } from "../src/checks/quality.js";
import { makeRepo } from "./helpers.js";

const run = (root: string) => quality(buildContext(root));
const words = (n: number) => "word ".repeat(n);
const rules = (fs: { rule: string; severity: string }[]) => fs.map((f) => `${f.rule}/${f.severity}`);
const sizeOnly = (fs: { rule: string; severity: string }[]) => rules(fs.filter((f) => f.rule === "file-size"));

test("a file read every session is noted when large and warned about when very large", (t) => {
  assert.deepEqual(sizeOnly(run(makeRepo(t, { "CLAUDE.md": words(2000) }))), []);
  assert.deepEqual(sizeOnly(run(makeRepo(t, { "CLAUDE.md": words(3000) }))), ["file-size/info"]);
  assert.deepEqual(sizeOnly(run(makeRepo(t, { "CLAUDE.md": words(6000) }))), ["file-size/warning"]);
  const [f] = run(makeRepo(t, { "CLAUDE.md": words(3000) })).filter((x) => x.rule === "file-size");
  assert.match(
    f?.message ?? "",
    /about 3,000 tokens \(1 lines\) and an agent reads all of it at the start of every session/,
  );
});

test("a file read only when needed may be larger before it is noted", (t) => {
  assert.deepEqual(sizeOnly(run(makeRepo(t, { "packages/a/AGENTS.md": words(5000) }))), []);
  assert.deepEqual(sizeOnly(run(makeRepo(t, { "packages/a/AGENTS.md": words(9000) }))), ["file-size/info"]);
});

test("the files read every session together are noted when they come to a lot, on the largest", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": words(2400), "AGENTS.md": words(2400), "GEMINI.md": words(4000) });
  const found = run(root);
  const budget = found.find((f) => f.rule === "context-budget");
  assert.equal(budget?.file, "GEMINI.md");
  assert.match(budget?.message ?? "", /The 3 files .* about 8,800 tokens/);
  assert.equal(
    run(makeRepo(t, { "CLAUDE.md": words(2400), "AGENTS.md": words(2400) })).some((f) => f.rule === "context-budget"),
    false,
  );
});

test("generic advice is called filler, with the phrase and its cost, and a statement with a code span is not", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": [
      "- Write clean code and follow best practices.",
      "- You are a helpful senior engineer.",
      "- Always use meaningful variable names.",
      "- Run `npm test` and write clean code.",
      "- The billing service retries three times.",
      "",
      "Think step by step before you answer.",
    ].join("\n"),
  });
  const filler = run(root).filter((f) => f.rule === "filler");
  assert.deepEqual(
    filler.map((f) => [f.line, f.subject]),
    [
      [1, "write clean code"],
      [2, "you are a helpful expert"],
      [3, "use meaningful names"],
      [7, "think step by step"],
    ],
  );
  assert.match(filler[0]?.message ?? "", /costs about \d+ tokens every time the file is read/);
  assert.equal(filler[0]?.severity, "info");
});

test("a heading that is repeated at the same level is noted, and at a different level it is not", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "# A\ntext\n## Setup\ntext\n## setup\ntext\n### Setup\ntext\n" });
  const found = run(root).filter((f) => f.rule === "duplicate-heading");
  assert.deepEqual(
    found.map((f) => [f.line, f.message]),
    [[5, 'The heading "setup" is also on line 3.']],
  );
});

test("an empty section is one with nothing under it, and a heading with a subsection or a code block is not empty", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": [
      "# Top",
      "## Has sub",
      "### Inner",
      "words here",
      "## Has code",
      "```",
      "x",
      "```",
      "## Empty",
      "## Next",
      "text",
      "## Last",
    ].join("\n"),
  });
  const found = run(root).filter((f) => f.rule === "empty-section");
  assert.deepEqual(
    found.map((f) => f.subject),
    ["Empty", "Last"],
  );
});

test("a long code block is noted at its start", (t) => {
  const block = (n: number) => `\`\`\`\n${"line\n".repeat(n)}\`\`\`\n`;
  assert.equal(
    run(makeRepo(t, { "CLAUDE.md": `x\n${block(60)}` })).some((f) => f.rule === "pasted-output"),
    false,
  );
  const found = run(makeRepo(t, { "CLAUDE.md": `x\n${block(61)}` })).filter((f) => f.rule === "pasted-output");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 2);
  assert.match(found[0]?.message ?? "", /61 lines/);
});

test("unfinished markers in text are counted in one finding, and in code are not", (t) => {
  const root = makeRepo(t, {
    "CLAUDE.md": "TODO: write this\nfine\nFIXME later\n`TODO in code`\n```\nTODO in a block\n```\ntbd lowercase\nTBD\n",
  });
  const found = run(root).filter((f) => f.rule === "todo-marker");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 1);
  assert.match(found[0]?.message ?? "", /3 unfinished markers .* The others are on lines 3, 9\./);
  const one = run(makeRepo(t, { "CLAUDE.md": "TODO: one\n" })).filter((f) => f.rule === "todo-marker");
  assert.match(one[0]?.message ?? "", /^An unfinished marker/);
  assert.doesNotMatch(one[0]?.message ?? "", /others/);
});

test("capitals for emphasis are noted only when there are a lot of them", (t) => {
  const few = makeRepo(t, { "CLAUDE.md": "You MUST do this. NEVER do that.\n" });
  assert.equal(
    run(few).some((f) => f.rule === "shouting"),
    false,
  );
  const many = makeRepo(t, {
    "CLAUDE.md":
      "CRITICAL: a. IMPORTANT: b. MUST c. NEVER d. ALWAYS e. WARNING f.\nDO NOT g. MUST h. NEVER i. ALWAYS j. IMPORTANT k. CRITICAL l.\n",
  });
  const [f] = run(many).filter((x) => x.rule === "shouting");
  assert.match(f?.message ?? "", /^12 words are in capitals/);
});

test("a top-level file that never shows a command is noted with low confidence, and one that does is not", (t) => {
  const prose =
    "This project is a small service for handling invoices for several customers across the company. ".repeat(6);
  const none = run(makeRepo(t, { "CLAUDE.md": prose })).filter((f) => f.rule === "no-commands");
  assert.deepEqual(rules(none), ["no-commands/info"]);
  assert.equal(none[0]?.confidence, "low");
  assert.equal(
    run(makeRepo(t, { "CLAUDE.md": `${prose}\n\`\`\`bash\nnpm test\n\`\`\`\n` })).some((f) => f.rule === "no-commands"),
    false,
  );
  assert.equal(
    run(makeRepo(t, { "CLAUDE.md": `${prose} Run \`make check\`.` })).some((f) => f.rule === "no-commands"),
    false,
  );
  assert.equal(
    run(makeRepo(t, { "packages/a/CLAUDE.md": prose })).some((f) => f.rule === "no-commands"),
    false,
    "nested files are not asked for commands",
  );
  assert.equal(
    run(makeRepo(t, { "CLAUDE.md": "Short.\n" })).some((f) => f.rule === "no-commands"),
    false,
    "a tiny file is not asked for commands",
  );
});

test("a file too big to read in full is said to be only partly checked", (t) => {
  const huge = `${"word ".repeat(450_000)}\n`; // about 2.2 MB
  const [f] = run(makeRepo(t, { "CLAUDE.md": huge })).filter((x) => x.rule === "file-too-large");
  assert.deepEqual([f?.severity, f?.confidence], ["warning", "high"]);
  assert.match(f?.message ?? "", /This file is 2\.\d MB\. Only the first 2 MB were checked/);
  assert.equal(
    run(makeRepo(t, { "CLAUDE.md": "small\n" })).some((x) => x.rule === "file-too-large"),
    false,
  );
});
