import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { check } from "../src/engine.js";
import { git as run } from "../src/gitrun.js";
import { git, makeRepo, write } from "./helpers.js";

// Tidybee reads repositories that other people made. These tests are about what a hostile one cannot make it do.

test("a repository's own Git settings cannot make Tidybee run a program", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "See `src/gone.ts` and `[a](gone.md)`.\n", "src/a.ts": "a" }, { git: true });
  const marker = join(root, "..", `tidybee-pwned-${process.pid}-${Date.now()}`);
  // With this setting, a plain "git ls-files", "git status" or "git check-ignore" runs the command.
  git(root, "config", "core.fsmonitor", `sh -c 'touch ${marker}; echo'`);
  git(root, "config", "core.hooksPath", join(root, "hooks"));
  check(root);
  assert.equal(existsSync(marker), false, "the command named in core.fsmonitor ran");
});

function snapshot(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) snapshot(full, out);
    else out.push(`${full}:${statSync(full).size}:${statSync(full).mtimeMs}`);
  }
  return out;
}

test("checking a repository changes nothing in it, not even the Git index or a lock file", (t) => {
  const root = makeRepo(
    t,
    { "CLAUDE.md": "See `src/gone.ts`.\n", "src/a.ts": "a", ".gitignore": "out/\n" },
    { git: true },
  );
  write(root, { "untracked.md": "u" });
  const before = snapshot(root);
  check(root, { minConfidence: "low" });
  check(root, { useGit: false });
  assert.deepEqual(snapshot(root), before);
  assert.equal(existsSync(join(root, ".git", "index.lock")), false);
});

test("the Git helper returns null when Git fails and passes input through", (t) => {
  const plain = makeRepo(t, { "a.md": "a" });
  assert.equal(run(plain, ["ls-files"]), null, "not a repository");
  const repo = makeRepo(t, { ".gitignore": "secret.txt\n", "a.md": "a" }, { git: true });
  assert.equal(run(repo, ["check-ignore", "--stdin", "-z"], { input: "secret.txt\0a.md\0" }), "secret.txt\0");
  assert.equal(
    run(repo, ["check-ignore", "--stdin", "-z"], { input: "a.md\0" }),
    null,
    "exit 1 when nothing is ignored",
  );
});
