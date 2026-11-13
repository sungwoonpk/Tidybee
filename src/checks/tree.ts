import type { Context, Doc } from "../analyze.js";
import { resolveRelative } from "../paths.js";
import type { Finding } from "../types.js";
import { describe, GENERATED, PLACEHOLDER } from "./refs.js";

// Instruction files often draw the layout of the repository as a tree. A tree is written once and then the folders move.
// Each entry in such a tree is checked against the repository.

interface Entry {
  name: string;
  line: number;
  column: number;
  /** The column the name starts in, which is how the depth in the tree is told. */
  col: number;
  isDir: boolean;
}

const CONNECTOR = /^([\s│|]*)(?:├──|└──|\|--|\+--|`--|├─|└─)\s*(.*)$/;

/** Reads the lines of a block as a tree, or returns null if the block does not look like one. */
export function parseTree(lines: { text: string; line: number }[]): { root: string | null; entries: Entry[] } | null {
  const entries: Entry[] = [];
  let root: string | null = null;
  let connectors = 0;
  for (const { text, line } of lines) {
    const m = CONNECTOR.exec(text);
    if (!m) {
      const label = text.trim().split(/\s{2,}/)[0] as string;
      if (root === null && connectors === 0 && label !== "") root = label.replace(/\/+$/, "");
      continue;
    }
    connectors++;
    const col = text.length - (m[2] as string).length;
    // The part before two or more spaces is the name, the rest a comment. A name list such as "a, b, c" is several names.
    // "a, b" and "a / b" are lists of names.
    const names = ((m[2] as string).split(/\s{2,}|\s+#\s|\s+<-|\s+←|\s+\/\/\s/)[0] as string).split(/,\s*|\s+\/\s+/);
    for (const n of names) {
      const trimmed = n.trim();
      // A line made only of lines and corners is the edge of a box in a diagram, not a name.
      if (trimmed === "" || !/[\p{L}\p{N}]/u.test(trimmed) || /[─│┌┐└┘├┤┬┴┼·]/.test(trimmed)) continue;
      entries.push({ name: trimmed.replace(/\/+$/, ""), line, column: col + 1, col, isDir: trimmed.endsWith("/") });
    }
  }
  // A first line with spaces or brackets in it, such as "AI Customization (Tree View)", is a picture of a screen, not of folders.
  if (root !== null && /[\s()[\]]/.test(root)) return null;
  return connectors >= 2 ? { root, entries } : null;
}

function paths(entries: Entry[]): { path: string; entry: Entry }[] {
  const out: { path: string; entry: Entry }[] = [];
  const stack: { name: string; col: number }[] = [];
  for (const e of entries) {
    while (stack.length > 0 && (stack[stack.length - 1] as { col: number }).col >= e.col) stack.pop();
    const parents = stack.map((s) => s.name);
    out.push({ path: [...parents, e.name].join("/"), entry: e });
    if (e.isDir || !e.name.includes(".")) stack.push({ name: e.name, col: e.col });
  }
  return out;
}

/**
 * Where the entries of a tree start. The first line of a tree may be the name of the project, a dot, a path, or the name of
 * a folder, and the same name can be a folder in several places. So each place it could be is tried, and the one under which
 * the most of the first-level entries really exist is taken. With no clear winner, a first line that is a path is that path,
 * and anything else is the root of the repository.
 */
function rootPrefixes(ctx: Context, doc: Doc, root: string | null, projectName: string, first: string[]): string[] {
  if (root === null || root === "." || root === projectName) return [""];
  const here = resolveRelative(doc.file.dir, root);
  const direct = [root, here].filter((p): p is string => p !== null && ctx.index.hasDir(p)).map((p) => `${p}/`);
  const named = root.includes("/") ? [] : ctx.index.dirsNamed(root).map((d) => `${d}/`);
  const candidates = [...new Set(["", ...direct, ...named])];
  const exists = (p: string): boolean => ctx.index.hasFile(p) || ctx.index.hasDir(p);
  const score = (prefix: string): number =>
    first.filter(
      (name) => exists(`${prefix}${name}`) || exists(resolveRelative(doc.file.dir, `${prefix}${name}`) ?? ""),
    ).length;
  const scored = candidates.map((p) => ({ p, n: score(p) })).sort((a, b) => b.n - a.n);
  const best = scored[0];
  if (best && best.n > 0) {
    // Every prefix that does as well as the best is kept, so that a folder name that is used twice is not decided by chance.
    return scored.filter((s) => s.n === best.n).map((s) => s.p);
  }
  return direct.length > 0 ? direct : named.length > 0 ? named : [""];
}

function treeFindings(ctx: Context, doc: Doc): Finding[] {
  const out: Finding[] = [];
  const rootName = ctx.index.root.split("/").pop() ?? "";
  for (const fence of doc.md.fences) {
    const tree = parseTree(fence.lines);
    if (!tree) continue;
    const entries = paths(tree.entries);
    const prefixes = rootPrefixes(
      ctx,
      doc,
      tree.root,
      rootName,
      entries.filter((e) => !e.path.includes("/")).map((e) => e.path),
    );
    const missing = new Set<string>();
    for (const { path, entry } of entries) {
      if (/[*<>{}()$…\s]|\.\.\./.test(path)) continue;
      if ([...missing].some((m) => path.startsWith(`${m}/`))) continue; // its folder is already reported
      const full = `${prefixes[0]}${path}`;
      const candidates = [
        ...new Set(prefixes.flatMap((p) => [`${p}${path}`, resolveRelative(doc.file.dir, `${p}${path}`)])),
      ].filter((p): p is string => p !== null);
      if (candidates.some((p) => ctx.index.hasFile(p) || ctx.index.hasDir(p))) continue;
      missing.add(path);
      if (candidates.some((p) => GENERATED.has(p.split("/")[0] as string)) || PLACEHOLDER.test(path)) continue;
      if (ctx.index.ignored(candidates).size > 0) continue;
      const evidence = candidates.map((p) => ctx.history.lookup(p)).find((e) => e !== undefined);
      const base = { file: doc.file.path, line: entry.line, column: entry.column, subject: full };
      if (evidence) {
        out.push({
          ...base,
          rule: "stale-tree",
          severity: "error",
          confidence: "high",
          message: `\`${full}\` is in the layout, but it is not in the repository. ${describe(evidence)}`,
          ...(evidence.kind === "renamed" && evidence.to ? { suggestion: `Write \`${evidence.to}\` instead.` } : {}),
        });
      } else {
        out.push({
          ...base,
          rule: "stale-tree",
          severity: "warning",
          confidence: "medium",
          message: `\`${full}\` is in the layout, but it is not in the repository.`,
        });
      }
    }
  }
  return out;
}

export function staleTrees(ctx: Context): Finding[] {
  return ctx.docs.flatMap((d) => treeFindings(ctx, d));
}
