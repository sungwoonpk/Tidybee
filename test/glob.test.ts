import assert from "node:assert/strict";
import { test } from "node:test";
import { countMatches, globToRegExp, splitGlobs } from "../src/glob.js";

const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

test("* stays inside a folder and ** crosses folders", () => {
  assert.ok(matches("src/*.ts", "src/a.ts"));
  assert.ok(!matches("src/*.ts", "src/deep/a.ts"));
  assert.ok(matches("src/**/*.ts", "src/a.ts"));
  assert.ok(matches("src/**/*.ts", "src/a/b/c.ts"));
  assert.ok(!matches("src/**/*.ts", "lib/a.ts"));
  assert.ok(matches("**/*.test.ts", "a/b/x.test.ts"));
  assert.ok(matches("**/*.test.ts", "x.test.ts"));
  assert.ok(matches("src/**", "src/a/b"));
});

test("a pattern with no slash matches the name in any folder, and one ending in a slash matches everything under it", () => {
  assert.ok(matches("*.md", "README.md"));
  assert.ok(matches("*.md", "docs/guide.md"));
  assert.ok(!matches("*.md", "docs/guide.txt"));
  assert.ok(matches("docs/", "docs/a/b.md"));
  assert.ok(!matches("docs/", "src/a.md"));
  assert.ok(matches("./src/*.ts", "src/a.ts"));
});

test("?, braces and character classes", () => {
  assert.ok(matches("a?.ts", "ab.ts"));
  assert.ok(!matches("a?.ts", "a/.ts"));
  assert.ok(matches("src/*.{ts,tsx}", "src/a.tsx"));
  assert.ok(matches("src/*.{ts,tsx}", "src/a.ts"));
  assert.ok(!matches("src/*.{ts,tsx}", "src/a.js"));
  assert.ok(matches("file[0-9].txt", "file7.txt"));
  assert.ok(matches("file[!0-9].txt", "filex.txt"));
  assert.ok(matches("a.b", "a.b"));
  assert.ok(!matches("a.b", "aXb"), "a dot is a dot");
  assert.ok(matches("{broken", "{broken"));
  assert.ok(matches("[broken", "[broken"));
});

test("splitGlobs splits on commas outside braces", () => {
  assert.deepEqual(splitGlobs("**/*.ts, **/*.tsx"), ["**/*.ts", "**/*.tsx"]);
  assert.deepEqual(splitGlobs("src/*.{ts,tsx},docs/**"), ["src/*.{ts,tsx}", "docs/**"]);
  assert.deepEqual(splitGlobs(" , "), []);
});

test("countMatches counts the files any glob matches", () => {
  assert.equal(countMatches(["**/*.ts", "*.md"], ["a.ts", "b/c.ts", "README.md", "x.js"]), 3);
  assert.equal(countMatches(["**/*.py"], ["a.ts"]), 0);
});
