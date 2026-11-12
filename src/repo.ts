import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** What Tidybee knows about the files in a repository. Paths are relative to the root and use forward slashes. */
export interface RepoIndex {
  root: string;
  files: string[];
  /** True when the list came from Git, so it follows .gitignore exactly. */
  usedGit: boolean;
  hasFile(path: string): boolean;
  hasDir(path: string): boolean;
  /** The real spelling of a path that exists only with different capitals, or undefined. */
  caseMatch(path: string): string | undefined;
  /** Files with this name anywhere in the repository. */
  byBasename(name: string): string[];
  /** True when the first part of the path is a file or folder at the top of the repository. */
  hasTopLevel(segment: string): boolean;
  read(path: string): string;
  /** Which of these paths Git would ignore. Empty when Git was not used. */
  ignored(paths: string[]): Set<string>;
}

const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".gradle",
  ".idea",
  ".cache",
]);

const MAX_FILES = 200_000;

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch {
    return null;
  }
}

function listWithGit(root: string): string[] | null {
  // Tracked files and files that are not ignored but not yet added, minus any deleted from disk but still in the index.
  const all = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (all === null) return null;
  const deleted = new Set((git(root, ["ls-files", "--deleted", "-z"]) ?? "").split("\0").filter(Boolean));
  return all.split("\0").filter((f) => f !== "" && !deleted.has(f));
}

/** Asks Git which of the paths a .gitignore rule covers, such as build output and local settings files. */
function ignoredBy(root: string, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  try {
    const out = execFileSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], {
      encoding: "utf8",
      input: paths.join("\0"),
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 30_000,
    });
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    // "git check-ignore" exits with 1 when none of the paths are ignored. Any other failure means Git cannot say.
    return new Set();
  }
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visit(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit("");
  return out;
}

/** Lists the files of a repository. With Git it follows .gitignore. Without Git it skips the usual build and dependency folders. */
export function indexRepo(root: string, options: { useGit?: boolean } = {}): RepoIndex {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);
  let files: string[] | null = options.useGit === false ? null : listWithGit(root);
  const usedGit = files !== null;
  files ??= walk(root);
  files = files.map((f) => f.replace(/\\/g, "/")).sort();

  const fileSet = new Set(files);
  const dirs = new Set<string>();
  const lower = new Map<string, string>();
  const basenames = new Map<string, string[]>();
  const top = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    top.add(parts[0] as string);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    lower.set(f.toLowerCase(), f);
    const name = parts[parts.length - 1] as string;
    basenames.set(name, [...(basenames.get(name) ?? []), f]);
  }
  for (const d of dirs) lower.set(d.toLowerCase(), d);

  return {
    root,
    files,
    usedGit,
    hasFile: (p) => fileSet.has(p),
    hasDir: (p) => p === "" || dirs.has(p),
    caseMatch: (p) => {
      const found = lower.get(p.toLowerCase());
      return found !== undefined && found !== p ? found : undefined;
    },
    byBasename: (name) => basenames.get(name) ?? [],
    hasTopLevel: (s) => top.has(s),
    read: (p) => readFileSync(join(root, p), "utf8"),
    ignored: (paths) => (usedGit ? ignoredBy(root, paths) : new Set()),
  };
}
