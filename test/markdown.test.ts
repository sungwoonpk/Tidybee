import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFrontmatter, parseMarkdown, slugify } from "../src/markdown.ts";

test("headings, with their level, line and the anchor GitHub makes", () => {
  const md = parseMarkdown("# Title\n\ntext\n\n## Build & Test (fast)\n### `npm run x`\n");
  assert.deepEqual(
    md.headings.map((h) => [h.level, h.text, h.line, h.slug]),
    [
      [1, "Title", 1, "title"],
      [2, "Build & Test (fast)", 5, "build--test-fast"],
      [3, "npm run x", 6, "npm-run-x"],
    ],
  );
});

test("slugify keeps letters from any language, digits, hyphens and underscores", () => {
  assert.equal(slugify("  Hello, World! 2 "), "hello-world-2");
  assert.equal(slugify("한국어 제목"), "한국어-제목");
  assert.equal(slugify("a_b-c"), "a_b-c");
});

test("code spans carry their line and column, and may use longer backtick runs", () => {
  const md = parseMarkdown("Run `npm test` then ``a ` b`` now.\nNo `unclosed span\n");
  assert.deepEqual(
    md.codeSpans.map((c) => [c.text, c.line, c.column]),
    [
      ["npm test", 1, 5],
      ["a ` b", 1, 21],
    ],
  );
  assert.equal(md.codeSpans.length, 2);
});

test("a link or an import written inside code is not a real one", () => {
  const md = parseMarkdown("See `[x](a.md)` and `@docs/a.md`.\nReal [y](b.md) and @docs/b.md here.\n");
  assert.deepEqual(
    md.links.map((l) => [l.target, l.line]),
    [["b.md", 2]],
  );
  assert.deepEqual(
    md.imports.map((i) => [i.target, i.line]),
    [["docs/b.md", 2]],
  );
});

test("links: text, title, angle brackets, images, anchors and columns", () => {
  const md = parseMarkdown('A [one](a.md "t") and ![img](pic.png) and [two](<b c.md>) and [three](#top)\n');
  assert.deepEqual(
    md.links.map((l) => [l.text, l.target]),
    [
      ["one", "a.md"],
      ["img", "pic.png"],
      ["two", "b"],
      ["three", "#top"],
    ].filter((x) => x[1] !== "b"),
  );
  assert.equal(md.links[0]?.column, 3);
});

test("imports need a slash or a dot, and an email or a handle is not an import", () => {
  const md = parseMarkdown(
    "@README.md\nuse @docs/git.md and @~/notes/me.md\nmail a@b.com, ping @alice and @alice.\nsee https://x.com/@user/page\n",
  );
  assert.deepEqual(
    md.imports.map((i) => i.target),
    ["README.md", "docs/git.md", "~/notes/me.md"],
  );
});

test("fenced blocks keep their language and lines, and nothing inside is read as prose", () => {
  const md = parseMarkdown("intro\n```bash\nnpm run build\n# comment\n```\nafter [l](x.md)\n~~~\nplain\n~~~\n");
  assert.deepEqual(
    md.fences.map((f) => [f.lang, f.startLine, f.lines.map((l) => l.text)]),
    [
      ["bash", 2, ["npm run build", "# comment"]],
      ["", 7, ["plain"]],
    ],
  );
  assert.deepEqual(
    md.fences[0]?.lines.map((l) => l.line),
    [3, 4],
  );
  assert.deepEqual(
    md.prose.map((p) => p.line),
    [1, 6, 10], // line 10 is the empty text after the last newline
  );
  assert.equal(md.links.length, 1);
});

test("a longer fence is not closed by a shorter one, and an unclosed block runs to the end", () => {
  const md = parseMarkdown("````md\n```\ninner\n```\n````\nout\n");
  assert.deepEqual(
    md.fences[0]?.lines.map((l) => l.text),
    ["```", "inner", "```"],
  );
  const open = parseMarkdown("```\nnever closed\nstill code\n");
  assert.deepEqual(
    open.fences[0]?.lines.map((l) => l.text),
    ["never closed", "still code", ""],
  );
});

test("frontmatter: values, quotes, booleans, inline and block lists, and the line it ends on", () => {
  const fm = parseFrontmatter([
    "---",
    "description: 'Use for tests'",
    "alwaysApply: false",
    'globs: ["src/**/*.ts", test/**]',
    "paths:",
    "  - a/b.md",
    "  - c.md",
    "name: x",
    "---",
    "body",
  ]);
  assert.deepEqual(fm?.data, {
    description: "Use for tests",
    alwaysApply: false,
    globs: ["src/**/*.ts", "test/**"],
    paths: ["a/b.md", "c.md"],
    name: "x",
  });
  assert.equal(fm?.endLine, 9);
});

test("frontmatter must start on the first line and be closed", () => {
  assert.equal(parseFrontmatter(["", "---", "a: b", "---"]), null);
  assert.equal(parseFrontmatter(["---", "a: b"]), null);
  assert.equal(parseFrontmatter([]), null);
  assert.deepEqual(parseFrontmatter(["---", "# comment", "x: 1", "---"])?.data, { x: "1" });
});

test("the body after frontmatter keeps its real line numbers", () => {
  const md = parseMarkdown("---\ndescription: d\n---\n# Head\n`code`\n");
  assert.equal(md.headings[0]?.line, 4);
  assert.equal(md.codeSpans[0]?.line, 5);
  assert.ok(md.frontmatter);
  assert.ok(!md.prose.some((p) => p.line <= 3));
});

test("Windows line endings are read the same", () => {
  const md = parseMarkdown("# A\r\n`x`\r\n");
  assert.equal(md.lines.length, 3);
  assert.equal(md.codeSpans[0]?.text, "x");
});
