import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

/** Runs a Git command in a folder and returns what it printed. */
export function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

/** Makes a temporary folder holding the given files, and removes it when the test ends. With git: true it is a repository with one commit. */
export function makeRepo(t: TestContext, files: Record<string, string>, options: { git?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "tidybee-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, files);
  if (options.git) {
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "first");
  }
  return root;
}
