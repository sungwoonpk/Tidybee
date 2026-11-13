import { alwaysTokens, type Context, type Doc } from "../analyze.js";
import { estimateTokens } from "../tokens.js";
import type { Finding } from "../types.js";

// Checks that are about the writing and not about what the file points at: size, filler, unfinished parts, structure.
// Their limits are a matter of judgment and not of any specification, so they are stated in docs/checks.md and each
// finding says what it measured.

/** At what size a file that is read at the start of every session is worth a note, and a warning. */
export const ALWAYS_NOTE_TOKENS = 2500;
export const ALWAYS_WARN_TOKENS = 5000;
/** A file that is read only when needed may be larger before it is worth a note. */
export const ON_DEMAND_NOTE_TOKENS = 8000;
/** The most the files read at the start of every session should come to before it is worth a note. */
export const BUDGET_TOKENS = 8000;
const LONG_BLOCK_LINES = 60;
const SHOUTING_WORDS = 12;

// Advice that a model follows without being told. It costs tokens every session and changes nothing. A statement that
// has a code span in it is about something particular, so it is never counted as filler.
const FILLER: [RegExp, string][] = [
  [/\bwrite (clean|readable|maintainable|high[- ]quality|good|quality) (code|software)\b/i, "write clean code"],
  [/\bfollow (the )?(best|good|industry) (practices|standards)\b/i, "follow best practices"],
  [/\buse (meaningful|descriptive|clear|good) (variable |function |method |class )?names\b/i, "use meaningful names"],
  [/\bthink (step by step|carefully|before you (act|code|answer))\b/i, "think step by step"],
  [/\byou are (a|an) (helpful|expert|senior|world[- ]class|experienced|professional)\b/i, "you are a helpful expert"],
  [/\b(don'?t|do not) (make|introduce|write) (any )?(mistakes|bugs|errors)\b/i, "do not make mistakes"],
  [/\bhandle (all )?errors (properly|gracefully|correctly)\b/i, "handle errors properly"],
  [/\b(keep|make) (the |your )?code (simple|clean|readable|maintainable|dry)\b/i, "keep code simple"],
  [/\bfollow (the )?(solid|dry|kiss) principles?\b/i, "follow SOLID or DRY"],
  [/\b(write|add) (good|clear|helpful|meaningful) (comments|documentation)\b/i, "write good comments"],
];

const EMPHASIS = /\b(CRITICAL|IMPORTANT|MUST|NEVER|ALWAYS|WARNING|DO NOT|DON'T|REQUIRED|MANDATORY)\b/g;

const RUNNERS =
  /^(npm|pnpm|yarn|bun|npx|make|just|cargo|go|pytest|python|python3|pip|poetry|uv|mvn|gradle|dotnet|bundle|rake|composer|deno|swift|xcodebuild|docker|tox|nox|ruff|eslint|tsc|vitest|jest)\b/;

const ROOT_KINDS = new Set(["claude", "agents", "gemini", "copilot", "conventions"]);

function sizeFindings(docs: Doc[]): Finding[] {
  const out: Finding[] = [];
  for (const d of docs) {
    const lines = d.md.lines.length;
    const base = { file: d.file.path, line: 1, column: 1 };
    if (d.load === "always" && d.tokens > ALWAYS_NOTE_TOKENS) {
      const warn = d.tokens > ALWAYS_WARN_TOKENS;
      out.push({
        ...base,
        rule: "file-size",
        severity: warn ? "warning" : "info",
        confidence: "medium",
        message: `This file is about ${d.tokens.toLocaleString("en-US")} tokens (${lines.toLocaleString("en-US")} lines) and an agent reads all of it at the start of every session.`,
        suggestion: "Move what is only sometimes needed into a file that is read on request, and keep this one short.",
      });
    } else if (d.load !== "always" && d.tokens > ON_DEMAND_NOTE_TOKENS) {
      out.push({
        ...base,
        rule: "file-size",
        severity: "info",
        confidence: "medium",
        message: `This file is about ${d.tokens.toLocaleString("en-US")} tokens (${lines.toLocaleString("en-US")} lines), and it is read in full whenever it is used.`,
      });
    }
  }
  const always = docs.filter((d) => alwaysTokens(d) > 0);
  const total = always.reduce((n, d) => n + alwaysTokens(d), 0);
  if (total > BUDGET_TOKENS && always.length > 1) {
    const biggest = always.reduce((a, b) => (alwaysTokens(b) > alwaysTokens(a) ? b : a));
    out.push({
      file: biggest.file.path,
      line: 1,
      column: 1,
      rule: "context-budget",
      severity: "info",
      confidence: "medium",
      message: `The ${always.length} files read at the start of every session come to about ${total.toLocaleString("en-US")} tokens, and this is the largest.`,
    });
  }
  return out;
}

function fillerFindings(docs: Doc[]): Finding[] {
  const out: Finding[] = [];
  for (const d of docs) {
    for (const s of d.md.statements) {
      if (s.text.includes("`")) continue;
      const hit = FILLER.find(([re]) => re.test(s.text));
      if (!hit) continue;
      out.push({
        file: d.file.path,
        line: s.line,
        column: 1,
        rule: "filler",
        severity: "info",
        confidence: "medium",
        subject: hit[1],
        message: `Generic advice ("${hit[1]}") that a model follows anyway. It costs about ${estimateTokens(s.text)} tokens every time the file is read.`,
        suggestion: "Say what is particular to this repository, or leave it out.",
      });
    }
  }
  return out;
}

function structureFindings(docs: Doc[]): Finding[] {
  const out: Finding[] = [];
  for (const d of docs) {
    const file = d.file.path;

    // The same heading twice at the same level.
    const seen = new Map<string, number>();
    for (const h of d.md.headings) {
      const key = `${h.level}:${h.text.toLowerCase()}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, h.line);
      else
        out.push({
          file,
          line: h.line,
          column: 1,
          rule: "duplicate-heading",
          severity: "info",
          confidence: "high",
          subject: h.text,
          message: `The heading "${h.text}" is also on line ${first}.`,
        });
    }

    // A heading with nothing under it, before a heading that is not a subheading.
    const nonBlank = new Set(
      d.md.body.filter((b) => b.text.trim() !== "" && !/^\s*#{1,6}\s/.test(b.text)).map((b) => b.line),
    );
    const fenceLines = new Set(d.md.fences.flatMap((f) => [f.startLine, ...f.lines.map((l) => l.line)]));
    d.md.headings.forEach((h, i) => {
      const next = d.md.headings[i + 1];
      if (next && next.level > h.level) return; // it has a subsection
      const end = next ? next.line : d.md.lines.length + 1;
      for (let l = h.line + 1; l < end; l++) if (nonBlank.has(l) || fenceLines.has(l)) return;
      out.push({
        file,
        line: h.line,
        column: 1,
        rule: "empty-section",
        severity: "info",
        confidence: "high",
        subject: h.text,
        message: `The section "${h.text}" has nothing in it.`,
      });
    });

    // A long block of pasted output or code.
    for (const f of d.md.fences) {
      if (f.lines.length > LONG_BLOCK_LINES) {
        const tokens = estimateTokens(f.lines.map((l) => l.text).join("\n"));
        out.push({
          file,
          line: f.startLine,
          column: 1,
          rule: "pasted-output",
          severity: "info",
          confidence: "medium",
          message: `A code block of ${f.lines.length} lines (about ${tokens.toLocaleString("en-US")} tokens) is read every time the file is. Link to it, or keep only the part that matters.`,
        });
      }
    }

    // Unfinished markers in running text.
    const marks = d.md.prose.filter((p) => /\b(TODO|FIXME|XXX|TBD)\b/.test(p.text));
    if (marks.length > 0) {
      const first = marks[0] as { line: number };
      const more = marks.slice(1).map((m) => m.line);
      out.push({
        file,
        line: first.line,
        column: 1,
        rule: "todo-marker",
        severity: "info",
        confidence: "medium",
        message: `${marks.length === 1 ? "An unfinished marker" : `${marks.length} unfinished markers`} (TODO, FIXME or TBD) in text an agent reads.${more.length > 0 ? ` The others are on line${more.length > 1 ? "s" : ""} ${more.slice(0, 8).join(", ")}${more.length > 8 ? " and more" : ""}.` : ""}`,
      });
    }

    // Capitals used for emphasis so often that they stop meaning anything.
    const shouts = d.md.prose.reduce((n, p) => n + (p.text.match(EMPHASIS)?.length ?? 0), 0);
    if (shouts >= SHOUTING_WORDS) {
      out.push({
        file,
        line: 1,
        column: 1,
        rule: "shouting",
        severity: "info",
        confidence: "medium",
        message: `${shouts} words are in capitals for emphasis (MUST, NEVER, IMPORTANT and the like). When everything is critical, nothing stands out.`,
      });
    }
  }
  return out;
}

/** A top-level file that never says how to build or test. */
function missingCommands(docs: Doc[]): Finding[] {
  const out: Finding[] = [];
  for (const d of docs) {
    if (d.file.dir !== "" || !ROOT_KINDS.has(d.file.kind) || d.tokens < 50) continue;
    const inFences = d.md.fences.some((f) => f.lines.some((l) => RUNNERS.test(l.text.trim().replace(/^[$>]\s+/, ""))));
    const inSpans = d.md.codeSpans.some((c) => RUNNERS.test(c.text.trim()));
    if (inFences || inSpans) continue;
    out.push({
      file: d.file.path,
      line: 1,
      column: 1,
      rule: "no-commands",
      severity: "info",
      confidence: "low",
      message: "This file never shows a command to build, test or run the project. An agent has to guess them.",
    });
  }
  return out;
}

export function quality(ctx: Context): Finding[] {
  return [
    ...sizeFindings(ctx.docs),
    ...fillerFindings(ctx.docs),
    ...structureFindings(ctx.docs),
    ...missingCommands(ctx.docs),
  ];
}
