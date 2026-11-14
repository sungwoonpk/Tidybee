import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { type Context, buildContext } from "../src/analyze.js";

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

/** The context of a temporary repository with one instruction file, for a test of a single check. */
export function contextOf(t: TestContext, text: string, name = "CLAUDE.md"): Context {
  return buildContext(makeRepo(t, { [name]: text }));
}

/** A string that looks random: a fixed seed, so a test is the same every run, and no run of the same or of following characters. */
export function randomText(
  length: number,
  alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  seed = 7,
): string {
  let x = seed * 2654435761;
  let out = "";
  while (out.length < length) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const c = alphabet[(x >>> 8) % alphabet.length] as string;
    // Skip a character that repeats the last one or follows it, so no test token looks like a placeholder or the alphabet.
    const last = out[out.length - 1];
    if (last !== undefined && (c === last || Math.abs(c.charCodeAt(0) - last.charCodeAt(0)) === 1)) continue;
    out += c;
  }
  return out;
}
