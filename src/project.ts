import type { RepoIndex } from "./repo.js";

export type Manager = "npm" | "pnpm" | "yarn" | "bun";

/** What the repository itself says about how it is built and run, so that commands in instruction files can be checked against it. */
export interface ProjectInfo {
  /** Names of the scripts in every package.json in the repository. */
  scripts: Set<string>;
  hasPackageJson: boolean;
  makeTargets: Set<string>;
  hasMakefile: boolean;
  justRecipes: Set<string>;
  hasJustfile: boolean;
  /** The package manager in charge of a folder: the one whose lockfile is nearest, going up to the root. */
  managerFor(dir: string): Manager | undefined;
  /** True when the repository could start with a bare "npm start" (it has a server.js). */
  hasDefaultStart: boolean;
}

const LOCKFILES: Record<string, Manager> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};

const MAKEFILES = new Set(["Makefile", "makefile", "GNUmakefile"]);
const JUSTFILES = new Set(["justfile", "Justfile", ".justfile"]);

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Names of the targets a Makefile defines, including .PHONY ones. Pattern rules, variables and special targets are left out. */
export function makeTargetsOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_./-]*(?:\s+[A-Za-z0-9_][A-Za-z0-9_./-]*)*)\s*:(?![=:])/.exec(line);
    if (!m) continue;
    for (const name of (m[1] as string).split(/\s+/)) if (!name.includes("%")) out.push(name);
  }
  return out;
}

/** Names of the recipes a justfile defines. */
export function justRecipesOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    // A recipe may have parameters, and a parameter may have a default with "=". A line with ":=" sets a variable.
    const m = /^@?([A-Za-z_][A-Za-z0-9_-]*)(?:\s+[^:\n]*)?:(?!=)/.exec(line);
    if (m) out.push(m[1] as string);
  }
  return out;
}

export function readProject(index: RepoIndex): ProjectInfo {
  const scripts = new Set<string>();
  const makeTargets = new Set<string>();
  const justRecipes = new Set<string>();
  const lockDirs = new Map<string, Manager>();
  let hasPackageJson = false;
  let hasMakefile = false;
  let hasJustfile = false;

  for (const path of index.files) {
    const name = baseName(path);
    if (name === "package.json") {
      hasPackageJson = true;
      try {
        const pkg = JSON.parse(index.read(path)) as { scripts?: Record<string, unknown>; packageManager?: unknown };
        for (const key of Object.keys(pkg.scripts ?? {})) scripts.add(key);
        const declared =
          typeof pkg.packageManager === "string" ? /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager)?.[1] : undefined;
        if (declared && !lockDirs.has(dirName(path))) lockDirs.set(dirName(path), declared as Manager);
      } catch {
        // A package.json that does not parse is not Tidybee's problem to report here.
      }
    } else if (MAKEFILES.has(name)) {
      hasMakefile = true;
      for (const t of makeTargetsOf(index.read(path))) makeTargets.add(t);
    } else if (JUSTFILES.has(name)) {
      hasJustfile = true;
      for (const r of justRecipesOf(index.read(path))) justRecipes.add(r);
    }
    const lock = LOCKFILES[name];
    if (lock) lockDirs.set(dirName(path), lock);
  }

  return {
    scripts,
    hasPackageJson,
    makeTargets,
    hasMakefile,
    justRecipes,
    hasJustfile,
    hasDefaultStart: index.hasFile("server.js"),
    managerFor(dir) {
      let d = dir;
      for (;;) {
        const m = lockDirs.get(d);
        if (m) return m;
        if (d === "") return undefined;
        d = dirName(d);
      }
    },
  };
}
