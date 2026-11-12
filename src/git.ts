import { git } from "./gitrun.js";

/** What Git remembers about a path that is no longer there. */
export interface Evidence {
  kind: "deleted" | "renamed";
  commit: string;
  /** The day of the commit, as YYYY-MM-DD. */
  date: string;
  /** Where it went, for a rename. */
  to?: string;
}

export interface History {
  /** Evidence for a path or a folder that is gone, or undefined when Git says nothing about it. */
  lookup(path: string): Evidence | undefined;
  /** Evidence for a file known only by its name, wherever it used to be. */
  lookupName(name: string): (Evidence & { path: string }) | undefined;
}

export const NO_HISTORY: History = { lookup: () => undefined, lookupName: () => undefined };

/** Reads the deletions and renames in the recent history of a repository. Returns an empty history when Git is not available. */
export function loadHistory(root: string, maxCommits = 5000): History {
  const out = git(root, [
    "log",
    "--name-status",
    "-M",
    "--diff-filter=DR",
    "--relative",
    `--max-count=${maxCommits}`,
    "--format=%x01%h%x09%cs",
  ]);
  if (out === null) return NO_HISTORY;

  // The log lists the newest commit first, so the first time a path appears is the latest thing that happened to it.
  const events = new Map<string, Evidence>();
  let commit = "";
  let date = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      [commit = "", date = ""] = line.slice(1).split("\t");
      continue;
    }
    const cols = line.split("\t");
    const status = cols[0] ?? "";
    if (status === "D" && cols[1] && !events.has(cols[1])) {
      events.set(cols[1], { kind: "deleted", commit, date });
    } else if (status.startsWith("R") && cols[1] && cols[2] && !events.has(cols[1])) {
      events.set(cols[1], { kind: "renamed", commit, date, to: cols[2] });
    }
  }

  return {
    lookupName(name) {
      for (const [old, ev] of events) {
        if (old === name || old.endsWith(`/${name}`)) return { ...ev, path: old };
      }
      return undefined;
    },
    lookup(path) {
      const exact = events.get(path);
      if (exact) return exact;
      // A folder that was removed or moved shows up as its files. Report the first one found.
      const prefix = `${path}/`;
      for (const [old, ev] of events) {
        if (!old.startsWith(prefix)) continue;
        if (ev.kind === "renamed" && ev.to) {
          const rest = old.slice(prefix.length);
          if (ev.to.endsWith(`/${rest}`)) {
            return { ...ev, to: ev.to.slice(0, ev.to.length - rest.length - 1) };
          }
          return { kind: "deleted", commit: ev.commit, date: ev.date };
        }
        return ev;
      }
      return undefined;
    },
  };
}
