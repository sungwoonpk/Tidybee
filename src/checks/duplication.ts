import type { Context, Doc } from "../analyze.js";
import { resolveRelative } from "../paths.js";
import type { Finding } from "../types.js";

// The same instructions written in more than one place, and copies that have drifted apart. A repository with a CLAUDE.md,
// an AGENTS.md and a Copilot file often has three copies of one text, and sooner or later someone edits one.

/** A statement shorter than this is too ordinary to count as a copy. */
const MIN_LENGTH = 50;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

interface Stmt {
  key: string;
  line: number;
}

function statementsOf(doc: Doc): Stmt[] {
  return doc.md.statements
    .map((s) => ({ key: normalize(s.text), line: s.line }))
    .filter((s) => s.key.length >= MIN_LENGTH);
}

function importsOf(doc: Doc, target: Doc): boolean {
  return doc.md.imports.some((i) => resolveRelative(doc.file.dir, i.target) === target.file.path);
}

function lines(ls: number[]): string {
  const unique = [...new Set(ls)];
  const shown = unique.slice(0, 6).join(", ");
  return unique.length > 6 ? `${shown} and more` : shown;
}

/** A statement that is written twice in the same file. */
function repeated(doc: Doc, stmts: Stmt[]): Finding[] {
  const out: Finding[] = [];
  const first = new Map<string, number>();
  for (const s of stmts) {
    const at = first.get(s.key);
    if (at === undefined) first.set(s.key, s.line);
    else if (at !== s.line)
      out.push({
        file: doc.file.path,
        line: s.line,
        column: 1,
        rule: "repeated-statement",
        severity: "info",
        confidence: "medium",
        message: `This is the same statement as on line ${at}.`,
      });
  }
  return out;
}

export function duplication(ctx: Context): Finding[] {
  const out: Finding[] = [];
  const docs = ctx.docs;
  const stmts = new Map(docs.map((d) => [d.file.path, statementsOf(d)]));
  for (const d of docs) out.push(...repeated(d, stmts.get(d.file.path) as Stmt[]));

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i] as Doc;
      const b = docs[j] as Doc;
      // Files that are never read together are not copies of each other, unless they sit side by side.
      const together = (a.load === "always" && b.load === "always") || a.file.dir === b.file.dir;
      if (!together || importsOf(a, b) || importsOf(b, a)) continue;
      const sa = stmts.get(a.file.path) as Stmt[];
      const sb = stmts.get(b.file.path) as Stmt[];
      if (sa.length < 3 || sb.length < 3) continue;

      const keysA = new Set(sa.map((s) => s.key));
      const keysB = new Set(sb.map((s) => s.key));
      const shared = [...keysA].filter((k) => keysB.has(k));
      if (shared.length < 3) continue;
      const onlyA = sa.filter((s) => !keysB.has(s.key));
      const onlyB = sb.filter((s) => !keysA.has(s.key));
      const jaccard = shared.length / (keysA.size + keysB.size - shared.length);
      const sharedLinesA = sa.filter((s) => keysB.has(s.key)).map((s) => s.line);
      const at = { file: a.file.path, line: sharedLinesA[0] as number, column: 1, subject: b.file.path };

      if (onlyA.length === 0 && onlyB.length === 0) {
        out.push({
          ...at,
          rule: "identical-files",
          severity: "info",
          confidence: "high",
          message: `\`${a.file.path}\` and \`${b.file.path}\` say the same thing, so the agents that read them are told it twice and the two will drift apart.`,
          suggestion: `Keep one and point the other at it, for example with the line \`@${b.file.path}\`.`,
        });
      } else if (jaccard >= 0.6 && onlyA.length > 0 && onlyB.length > 0) {
        out.push({
          ...at,
          rule: "drifting-files",
          severity: "warning",
          confidence: "medium",
          message: `\`${a.file.path}\` and \`${b.file.path}\` are mostly the same (${Math.round(jaccard * 100)}%), and have drifted: ${onlyA.length} statement${onlyA.length === 1 ? " is" : "s are"} only here (line${onlyA.length === 1 ? "" : "s"} ${lines(onlyA.map((s) => s.line))}), and ${onlyB.length} only there (line${onlyB.length === 1 ? "" : "s"} ${lines(onlyB.map((s) => s.line))}).`,
          suggestion: "Decide which is right, and keep one source.",
        });
      } else if (shared.length >= 5) {
        // When one file holds everything the other says, that is not drift: one is a copy of part of the other.
        const inside =
          onlyA.length === 0
            ? { small: a, big: b, extra: onlyB.length }
            : onlyB.length === 0
              ? { small: b, big: a, extra: onlyA.length }
              : null;
        out.push({
          ...at,
          rule: "duplicate-content",
          severity: "info",
          confidence: "medium",
          message: inside
            ? `Everything in \`${inside.small.file.path}\` is also in \`${inside.big.file.path}\`, which says ${inside.extra} more statement${inside.extra === 1 ? "" : "s"}.`
            : `${shared.length} statements here are also in \`${b.file.path}\` (line${new Set(sharedLinesA).size === 1 ? "" : "s"} ${lines(sharedLinesA)} here).`,
          ...(inside
            ? {
                suggestion: `Keep the shared part in one place and point the other at it, for example with \`@${inside.big.file.path}\`.`,
              }
            : {}),
        });
      }
    }
  }
  return out;
}
