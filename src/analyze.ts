import { type InstructionFile, type Load, discover } from "./discover.js";
import { type History, NO_HISTORY, loadHistory } from "./git.js";
import { type ParsedMarkdown, parseMarkdown } from "./markdown.js";
import { type ProjectInfo, readProject } from "./project.js";
import { type RepoIndex, indexRepo } from "./repo.js";
import { estimateTokens } from "./tokens.js";

/** An instruction file, read and ready to be checked. */
export interface Doc {
  file: InstructionFile;
  text: string;
  md: ParsedMarkdown;
  tokens: number;
  /** When an agent reads it, after looking at what its own settings say. */
  load: Load;
}

/** Everything a check may look at. */
export interface Context {
  index: RepoIndex;
  docs: Doc[];
  project: ProjectInfo;
  history: History;
}

function scalar(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/** Refines the default for a file with what its own header says. Cursor, Windsurf and Kiro each choose in their own words. */
export function loadModeOf(file: InstructionFile, md: ParsedMarkdown): Load {
  const fm = md.frontmatter?.data ?? {};
  switch (file.kind) {
    case "cursor-rule":
      if (fm.alwaysApply === true) return "always";
      return fm.globs !== undefined && fm.globs !== "" && !(Array.isArray(fm.globs) && fm.globs.length === 0)
        ? "scoped"
        : "on-demand";
    case "windsurf-rule": {
      const trigger = scalar(fm.trigger);
      if (trigger === "always_on") return "always";
      return trigger === "glob" ? "scoped" : "on-demand";
    }
    case "steering": {
      const inclusion = scalar(fm.inclusion);
      if (inclusion === "" || inclusion === "always") return "always";
      return inclusion === "filematch" ? "scoped" : "on-demand";
    }
    default:
      return file.load;
  }
}

/** The tokens a file costs at the start of every session. A skill costs only its name and description until it is used. */
export function alwaysTokens(doc: Doc): number {
  if (doc.file.kind === "skill") {
    const fm = doc.md.frontmatter?.data ?? {};
    return estimateTokens(`${scalar(fm.name)} ${typeof fm.description === "string" ? fm.description : ""}`);
  }
  return doc.load === "always" ? doc.tokens : 0;
}

export function loadDocs(index: RepoIndex): Doc[] {
  return discover(index).map((file) => {
    const text = index.read(file.path);
    const md = parseMarkdown(text);
    return { file, text, md, tokens: estimateTokens(text), load: loadModeOf(file, md) };
  });
}

export function buildContext(root: string, options: { useGit?: boolean } = {}): Context {
  const index = indexRepo(root, options);
  const useGit = index.usedGit;
  return {
    index,
    docs: loadDocs(index),
    project: readProject(index),
    history: useGit ? loadHistory(root) : NO_HISTORY,
  };
}
