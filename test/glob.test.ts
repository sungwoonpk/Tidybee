import assert from "node:assert/strict";
import { test } from "node:test";
import { anyMatch, compileGlob, countMatches, splitGlobs } from "../src/glob.js";

const matches = (glob: string, path: string) => (compileGlob(glob) as (p: string) => boolean)(path);

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

test("braces may be nested, and an alternative with no slash is not matched in any folder", () => {
  const g = "build/{oss/**,common/x.ts,{win32,linux}/steps/*.yml}";
  assert.ok(matches(g, "build/oss/a/b.txt"));
  assert.ok(matches(g, "build/common/x.ts"));
  assert.ok(matches(g, "build/win32/steps/a.yml"));
  assert.ok(matches(g, "build/linux/steps/b.yml"));
  assert.ok(!matches(g, "build/darwin/steps/a.yml"));
  assert.ok(!matches(g, "other/common/x.ts"));
  assert.ok(!matches("src/{a,b}.ts", "src/deep/a.ts"));
  assert.ok(matches("{a,b}.md", "docs/a.md"), "with no slash anywhere, the name matches in any folder");
  assert.deepEqual(splitGlobs("a/{b,{c,d}},e"), ["a/{b,{c,d}}", "e"]);
});

test("a leading slash fixes the pattern to the root, and a pattern with no slash matches anywhere", () => {
  assert.ok(matches("/README.md", "README.md"));
  assert.ok(!matches("/README.md", "docs/README.md"));
  assert.ok(matches("README.md", "docs/README.md"));
});

test("a glob that is too long, empty, or has too many choices is not judged", () => {
  assert.equal(compileGlob(""), null);
  assert.equal(compileGlob("a".repeat(301)), null);
  assert.equal(compileGlob("{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}"), null, "128 choices");
  assert.notEqual(compileGlob("{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}"), null, "64 choices");
});

test("anyMatch and countMatches say so when a glob cannot be judged, and not that nothing matches", () => {
  const files = ["a.ts", "b/c.ts"];
  assert.equal(anyMatch(["**/*.ts"], files), true);
  assert.equal(anyMatch(["**/*.py"], files), false);
  assert.equal(anyMatch(["a".repeat(400)], files), undefined);
  assert.equal(countMatches(["a".repeat(400)], files), -1);
});

// The patterns and the paths both come from a repository that may be hostile. With regular expressions these would run
// for ever. Here they must finish at once.
test("patterns built to make a matcher backtrack finish quickly", () => {
  const deep = `${"a/".repeat(60)}b`;
  const start = performance.now();
  assert.equal(matches("**/".repeat(40) + "x.ts", deep), false);
  assert.equal(matches("*a".repeat(40) + "b", "a".repeat(500)), false);
  assert.equal(matches("**/*a*a*a*a*a*a*a*a*a*a*b", `${"a".repeat(200)}/${"a".repeat(200)}`), false);
  assert.equal(matches("{a,b}/**/{c,d}/**/{e,f}/**/z", deep), false);
  assert.ok(performance.now() - start < 1000, `took ${Math.round(performance.now() - start)} ms`);
});

test("a path with thousands of folders is matched without trouble", () => {
  const path = `${"d/".repeat(5000)}x.ts`;
  const start = performance.now();
  assert.equal(matches("**/*.ts", path), true);
  assert.equal(matches("**/a/**/b/x.ts", path), false);
  assert.ok(performance.now() - start < 1000);
});
