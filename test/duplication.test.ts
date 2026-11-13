import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { duplication, normalize } from "../src/checks/duplication.js";
import { makeRepo } from "./helpers.js";

const run = (root: string) => duplication(buildContext(root));
const S = (n: number) => `Statement number ${n} is long enough to count as a real instruction in this file.`;
const doc = (...ns: number[]) => ns.map((n) => `- ${S(n)}`).join("\n") + "\n";
const summary = (fs: { rule: string; severity: string; file: string }[]) =>
  fs.map((f) => `${f.rule}/${f.severity}/${f.file}`);

test("normalize ignores case, emphasis, punctuation and spacing", () => {
  assert.equal(normalize("**Always** run `npm test`,  then   lint!"), "always run npm test then lint");
  assert.equal(normalize("한국어, 문장!"), "한국어 문장");
});

test("two files that say the same thing are reported once, with how to join them", (t) => {
  const root = makeRepo(t, { "AGENTS.md": doc(1, 2, 3, 4), "CLAUDE.md": doc(1, 2, 3, 4) });
  const found = run(root);
  assert.deepEqual(summary(found), ["identical-files/info/AGENTS.md"]);
  assert.equal(found[0]?.confidence, "high");
  assert.equal(found[0]?.suggestion, "Keep one and point the other at it, for example with the line `@CLAUDE.md`.");
});

test("copies that each have something the other lacks are drifting, and the message says how much and where", (t) => {
  const root = makeRepo(t, { "AGENTS.md": doc(1, 2, 3, 4, 5, 6, 7), "CLAUDE.md": doc(1, 2, 3, 4, 5, 6, 8, 9) });
  const [f] = run(root);
  assert.equal(f?.rule, "drifting-files");
  assert.equal(f?.severity, "warning");
  assert.match(
    f?.message ?? "",
    /mostly the same \(67%\), and have drifted: 1 statement is only here \(line 7\), and 2 only there \(lines 7, 8\)/,
  );
});

test("when one file holds everything the other says, it is a copy of part and not drift", (t) => {
  const root = makeRepo(t, { "AGENTS.md": doc(1, 2, 3, 4, 5), "CLAUDE.md": doc(1, 2, 3, 4, 5, 6, 7) });
  const [f] = run(root);
  assert.equal(f?.rule, "duplicate-content");
  assert.equal(f?.message, "Everything in `AGENTS.md` is also in `CLAUDE.md`, which says 2 more statements.");
  assert.match(f?.suggestion ?? "", /@CLAUDE\.md/);
});

test("files that share some statements but are mostly different are only a note", (t) => {
  const root = makeRepo(t, {
    "AGENTS.md": doc(1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 16),
    "CLAUDE.md": doc(1, 2, 3, 4, 5, 20, 21, 22, 23, 24, 25, 26),
  });
  const [f] = run(root);
  assert.equal(f?.rule, "duplicate-content");
  assert.match(f?.message ?? "", /^5 statements here are also in `CLAUDE\.md` \(lines 1, 2, 3, 4, 5 here\)\.$/);
});

test("fewer than three shared statements, short statements, and files with too little in them are not compared", (t) => {
  assert.deepEqual(run(makeRepo(t, { "AGENTS.md": doc(1, 2, 3, 4), "CLAUDE.md": doc(1, 2, 10, 11) })), []);
  assert.deepEqual(
    run(
      makeRepo(t, {
        "AGENTS.md": "- Short one.\n- Short two.\n- Short three.\n",
        "CLAUDE.md": "- Short one.\n- Short two.\n- Short three.\n",
      }),
    ),
    [],
  );
  assert.deepEqual(run(makeRepo(t, { "AGENTS.md": doc(1, 2), "CLAUDE.md": doc(1, 2) })), []);
});

test("a file that imports the other is meant to share its text", (t) => {
  const root = makeRepo(t, { "AGENTS.md": doc(1, 2, 3, 4), "CLAUDE.md": `@AGENTS.md\n${doc(1, 2, 3, 4)}` });
  assert.deepEqual(run(root), []);
});

test("files that are read at different times and in different folders are not copies of each other", (t) => {
  const root = makeRepo(t, { "AGENTS.md": doc(1, 2, 3, 4), "packages/a/CLAUDE.md": doc(1, 2, 3, 4) });
  assert.deepEqual(run(root), []);
  const sameFolder = makeRepo(t, { "packages/a/AGENTS.md": doc(1, 2, 3, 4), "packages/a/CLAUDE.md": doc(1, 2, 3, 4) });
  assert.deepEqual(summary(run(sameFolder)), ["identical-files/info/packages/a/AGENTS.md"]);
});

test("a statement written twice in one file is noted on the second", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": `${doc(1, 2)}\nSome other text here.\n${doc(1)}` });
  const found = run(root);
  assert.deepEqual(
    found.map((f) => [f.rule, f.line, f.message]),
    [["repeated-statement", 5, "This is the same statement as on line 1."]],
  );
});
