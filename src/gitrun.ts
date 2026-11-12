import { execFileSync } from "node:child_process";

/**
 * Runs a Git command in a repository and returns what it printed, or null if it failed.
 *
 * Tidybee reads repositories it did not make, so this is careful. A repository's own settings can name a program for
 * Git to run, and with "core.fsmonitor" even a plain "git ls-files" or "git status" runs it. That setting is turned off
 * here. The commands Tidybee uses only read, and "GIT_OPTIONAL_LOCKS=0" keeps them from writing even a lock file.
 */
export function git(root: string, args: string[], options: { input?: string; maxBuffer?: number } = {}): string | null {
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
      encoding: "utf8",
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
      maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
      timeout: 30_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      ...(options.input === undefined ? {} : { input: options.input }),
    });
  } catch {
    return null;
  }
}
