import type { RepoIndex } from "./repo.js";

/** The kinds of instruction file Tidybee knows. */
export type Kind =
  | "claude"
  | "agents"
  | "gemini"
  | "conventions"
  | "legacy-rules"
  | "cursor-rule"
  | "windsurf-rule"
  | "cline-rule"
  | "copilot"
  | "copilot-scoped"
  | "claude-command"
  | "claude-agent"
  | "skill"
  | "steering";

/** When an agent reads a file: at the start of every session, only for some files or places, or when asked for. */
export type Load = "always" | "scoped" | "on-demand";

export interface InstructionFile {
  path: string;
  kind: Kind;
  /** The folder the file lives in, relative to the root. Empty at the root. */
  dir: string;
  load: Load;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function classify(path: string): { kind: Kind; load: Load } | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const atRoot = !path.includes("/");
  // Files that an agent reads from the folder it works in, so a nested one is read only for work in that folder.
  const byName: Record<string, Kind> = {
    "CLAUDE.md": "claude",
    "CLAUDE.local.md": "claude",
    "AGENTS.md": "agents",
    "AGENT.md": "agents",
    "GEMINI.md": "gemini",
  };
  if (byName[name]) return { kind: byName[name] as Kind, load: atRoot ? "always" : "on-demand" };
  if (atRoot && name === "CONVENTIONS.md") return { kind: "conventions", load: "always" };
  if (atRoot && (name === ".cursorrules" || name === ".windsurfrules" || name === ".clinerules")) {
    return { kind: "legacy-rules", load: "always" };
  }
  if (path === ".github/copilot-instructions.md") return { kind: "copilot", load: "always" };
  if (/^\.github\/instructions\/[^/]+\.instructions\.md$/.test(path)) return { kind: "copilot-scoped", load: "scoped" };
  if (/^\.cursor\/rules\/.+\.(mdc|md)$/.test(path)) return { kind: "cursor-rule", load: "scoped" };
  if (/^\.windsurf\/rules\/[^/]+\.md$/.test(path)) return { kind: "windsurf-rule", load: "scoped" };
  if (/^\.clinerules\/[^/]+\.md$/.test(path)) return { kind: "cline-rule", load: "always" };
  if (/^\.claude\/commands\/.+\.md$/.test(path)) return { kind: "claude-command", load: "on-demand" };
  if (/^\.claude\/agents\/[^/]+\.md$/.test(path)) return { kind: "claude-agent", load: "on-demand" };
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path)) return { kind: "skill", load: "on-demand" };
  if (/^\.kiro\/steering\/[^/]+\.md$/.test(path)) return { kind: "steering", load: "always" };
  return null;
}

/** Finds the instruction files of every agent Tidybee knows, in the repository. */
export function discover(index: RepoIndex): InstructionFile[] {
  const found: InstructionFile[] = [];
  for (const path of index.files) {
    const c = classify(path);
    if (c) found.push({ path, dir: dirOf(path), ...c });
  }
  return found;
}
