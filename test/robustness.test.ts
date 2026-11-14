import assert from "node:assert/strict";
import { test } from "node:test";
import { candidatesIn } from "../src/checks/refs.js";
import { commandsIn } from "../src/checks/commands.js";
import { parseTree } from "../src/checks/tree.js";
import { hiddenText } from "../src/checks/hidden.js";
import { riskyCommands } from "../src/checks/risky.js";
import { secrets } from "../src/checks/secrets.js";
import { parseMarkdown } from "../src/markdown.js";
import { contextOf } from "./helpers.js";

// Tidybee reads repositories that other people wrote, so a file made to make it hang must not be able to. Each of these
// lines took many seconds, or never finished, with the first version of the reader, and each must now be quick.

const N = 60_000;
const LIMIT_MS = 1500;

function quick(name: string, fn: () => void): void {
  test(`a hostile input does not hang the reader: ${name}`, () => {
    const start = performance.now();
    fn();
    const ms = performance.now() - start;
    assert.ok(ms < LIMIT_MS, `took ${Math.round(ms)} ms`);
  });
}

quick("a heading with a very long run of spaces", () => parseMarkdown(`# a${" ".repeat(N)}b\n`));
quick("a heading with many hashes", () => parseMarkdown(`# a ${"# ".repeat(N)}x\n`));
quick("a very long line of words", () => parseMarkdown(`${"word ".repeat(N)}\n`));
quick("only backticks", () => parseMarkdown(`${"`".repeat(N)}\n`));
quick("backticks and spaces", () => parseMarkdown(`${"` ".repeat(N)}\n`));
quick("brackets and parentheses that never close", () => parseMarkdown(`${"[a](".repeat(30_000)}\n`));
quick("brackets with no closing bracket", () => parseMarkdown(`${"[a".repeat(N / 2)}\n`));
quick("a link with a very long target", () => parseMarkdown(`[a](${"b".repeat(N)})\n`));
quick("many at signs", () => parseMarkdown(`${"@a/b ".repeat(N / 5)}\n`));
quick("dots and slashes", () => parseMarkdown(`${"a./".repeat(N / 3)}\n`));
quick("many list markers", () => parseMarkdown(`${"- ".repeat(N)}x\n`));
quick("many one-word sentences", () => parseMarkdown(`${"A. ".repeat(N / 3)}\n`));
quick("comments that never close", () => parseMarkdown(`${"<!-- ".repeat(N / 5)}\n`));
quick("a very long list in the header", () => parseMarkdown(`---\nk:\n${"  - x\n".repeat(N / 4)}---\n`));
quick("a fence marker of tens of thousands of characters", () =>
  parseMarkdown(`${"~".repeat(N)}\ntext\n${"~".repeat(N)}\n`),
);
quick("thousands of unclosed fences", () => parseMarkdown("```\n".repeat(N / 4)));
quick("a file of a hundred thousand short lines", () => parseMarkdown("- a b c\n".repeat(100_000)));
quick("paths: one very long token", () => candidatesIn("a/".repeat(N / 2), 1, 1, false, () => true));
quick("paths: many short tokens", () => candidatesIn("a/b.ts ".repeat(N / 7), 1, 1, false, () => true));
quick("commands: a very long line", () => commandsIn("npm run x && ".repeat(N / 13)));
quick("commands: many variable settings", () => commandsIn(`${"A=b ".repeat(N / 4)}npm test`));
quick("a tree with a very long line", () =>
  parseTree([
    { text: `├── ${"a ".repeat(N)}`, line: 1 },
    { text: "└── b", line: 2 },
  ]),
);
quick("a tree of many entries", () =>
  parseTree(Array.from({ length: 20_000 }, (_, i) => ({ text: `├── file${i}.ts`, line: i + 1 }))),
);

// The safety checks read every line of a file with regular expressions, so each is tried on a file made to be slow. The
// file is read before the clock starts, since reading is not what is being timed.
function slowCheck(name: string, text: string, check: (ctx: ReturnType<typeof contextOf>) => unknown): void {
  test(`a hostile file does not hang the safety checks: ${name}`, (t) => {
    const ctx = contextOf(t, text);
    const start = performance.now();
    check(ctx);
    const ms = performance.now() - start;
    assert.ok(ms < LIMIT_MS, `took ${Math.round(ms)} ms`);
  });
}

const BIG = 1_500_000;
/** The same text in the places where the risk check reads: in running text, in a shell block, in a comment and in a code span. */
const everywhere = (text: string): string =>
  `${text}\n\n\`\`\`sh\n${text}\n\`\`\`\n\n<!-- ${text} -->\n\n\`${text}\`\n`;
for (const [name, unit] of [
  ["many downloads", "curl a "],
  ["prefixes of keys", "sk-ant-"],
  ["the start of a token", "AKIA"],
  ["names of secrets", "api_key="],
  ["the start of a URL with a password", "a://a:b@"],
  ["the start of a web token", "eyJ"],
  ["home folders", "/Users/a/"],
  ["the start of a webhook", "https://hooks.slack.com/services/T"],
  ["flags", "curl -"],
  ["shells", "| sh "],
  ["many pipes to a shell", "curl a | "],
  ["decoders", "base64 -d "],
  ["private key headers", "-----BEGIN "],
] as const) {
  slowCheck(name, everywhere(unit.repeat(BIG / 4 / unit.length)), (c) => [
    ...secrets(c),
    ...riskyCommands(c),
    ...hiddenText(c),
  ]);
}
slowCheck("a long run of one key alphabet", `sk-${"a1".repeat(BIG / 2)}\n`, secrets);
slowCheck("a long assignment", `token=${"aB3".repeat(BIG / 3)}\n`, secrets);
slowCheck("a million zero-width characters", `a${String.fromCodePoint(0x200b).repeat(BIG)}\n`, hiddenText);
slowCheck("a million tag characters", `a${String.fromCodePoint(0xe0041).repeat(BIG / 2)}\n`, hiddenText);
slowCheck("a hundred thousand short lines of a command", "```sh\ncurl x | sh\n".repeat(50_000), riskyCommands);
slowCheck("comments that never close", "<!-- curl x | sh ".repeat(BIG / 17), (c) => [
  ...hiddenText(c),
  ...riskyCommands(c),
]);

test("the odd input still gives sensible answers, not only fast ones", () => {
  assert.equal(parseMarkdown(`# a${" ".repeat(1000)}b\n`).headings[0]?.text, `a${" ".repeat(1000)}b`);
  assert.equal(parseMarkdown(`[a](${"b".repeat(1000)})\n`).links[0]?.target.length, 1000);
  assert.equal(parseMarkdown(`[a](${"b".repeat(3000)})\n`).links.length, 0, "a target over the limit is not a link");
});
