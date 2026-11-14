import type { Context, Doc } from "../analyze.js";
import { decodeTags, hiddenKind, shorten } from "../text.js";
import type { Finding } from "../types.js";

// Text that a person does not see and an agent does. An instruction file is read by a model that does what it says, so
// whatever is hidden in it is an instruction that nobody reviewed.

/** The most findings of one kind in one file. A file full of them is one problem, said once. */
const MAX_TAG_FINDINGS = 10;
/** This many invisible characters on one line is not a stray paste, it is carrying data. */
const BULK_ZERO_WIDTH = 8;

const FLAG_EMOJI_BASE = 0x1f3f4; // a black flag followed by tag letters is the flag of England, Scotland or Wales

interface Group {
  count: number;
  /** The most on one line. */
  densest: number;
  lines: number[];
  first: { line: number; column: number; cp: number };
}

function isWordChar(cp: number | undefined): boolean {
  return cp !== undefined && ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a));
}

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function lineList(lines: number[], first: number): string {
  const more = [...new Set(lines)].filter((l) => l !== first);
  if (more.length === 0) return "";
  const shown = more.slice(0, 8).join(", ");
  return ` The same on line${more.length > 1 ? "s" : ""} ${shown}${more.length > 8 ? " and more" : ""}.`;
}

function invisibleIn(doc: Doc): Finding[] {
  const out: Finding[] = [];
  const groups = new Map<string, Group>();
  let tags = 0;
  let tagsSkipped = 0;
  const note = (kind: string, cp: number, line: number, column: number, onLine: number): void => {
    const g = groups.get(kind);
    if (!g) {
      groups.set(kind, { count: 1, densest: onLine, lines: [line], first: { line, column, cp } });
      return;
    }
    g.count++;
    g.densest = Math.max(g.densest, onLine);
    if (g.lines[g.lines.length - 1] !== line && g.lines.length < 50) g.lines.push(line);
  };

  const lines = doc.md.lines;
  for (let li = 0; li < lines.length; li++) {
    const text = lines[li] as string;
    const lineNo = li + 1;
    let prev: number | undefined;
    const onLine = new Map<string, number>();
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i) as number;
      const len = cp > 0xffff ? 2 : 1;
      let kind = hiddenKind(cp);
      if (kind === null || (cp === 0xfeff && li === 0 && i === 0)) {
        prev = cp;
        i += len;
        continue;
      }

      if (kind === "tag") {
        // A run of tag characters. After a black flag it is a regional flag, which is drawn.
        let j = i;
        let run = "";
        while (j < text.length) {
          const c = text.codePointAt(j) as number;
          if (hiddenKind(c) !== "tag") break;
          run += String.fromCodePoint(c);
          j += 2;
        }
        if (prev === FLAG_EMOJI_BASE) {
          prev = 0xe007f;
          i = j;
          continue;
        }
        if (tags < MAX_TAG_FINDINGS) {
          tags++;
          const said = shorten(decodeTags(run), 120);
          out.push({
            file: doc.file.path,
            line: lineNo,
            column: i + 1,
            rule: "invisible-text",
            severity: "error",
            confidence: "high",
            subject: said === "" ? hex(cp) : said,
            message:
              said === ""
                ? `${[...run].length} invisible Unicode tag characters. They draw nothing, and they can spell text that a model reads.`
                : `Text written in invisible Unicode tag characters, which no font draws: "${said}". A person sees nothing here and a model can read it.`,
            suggestion:
              "Delete the characters. Nobody writes tag characters by hand, so find out where they came from.",
          });
        } else tagsSkipped++;
        prev = 0xe007f;
        i = j;
        continue;
      }

      if (kind === "joiner") {
        // Meant in emoji and in some scripts. Between two plain letters or digits it is meant for nothing.
        const next = text.codePointAt(i + len);
        if (!(isWordChar(prev) && isWordChar(next))) {
          prev = cp;
          i += len;
          continue;
        }
        kind = "zero-width";
      }
      if (kind === "mark") {
        prev = cp;
        i += len;
        continue;
      }

      const n = (onLine.get(kind) ?? 0) + 1;
      onLine.set(kind, n);
      note(kind, cp, lineNo, i + 1, n);
      prev = cp;
      i += len;
    }
  }
  if (tagsSkipped > 0) {
    out.push({
      file: doc.file.path,
      line: 1,
      column: 1,
      rule: "invisible-text",
      severity: "error",
      confidence: "high",
      message: `${tagsSkipped} more runs of invisible tag characters were not listed.`,
    });
  }

  for (const [kind, g] of groups) {
    const base = {
      file: doc.file.path,
      line: g.first.line,
      column: g.first.column,
      rule: "invisible-text",
      subject: hex(g.first.cp),
    };
    const where = lineList(g.lines, g.first.line);
    const what = `${g.count.toLocaleString("en-US")} ${g.count === 1 ? "character" : "characters"}`;
    if (kind === "zero-width") {
      const bulk = g.densest >= BULK_ZERO_WIDTH;
      out.push({
        ...base,
        severity: bulk ? "error" : "warning",
        confidence: bulk ? "high" : "medium",
        message: bulk
          ? `${g.densest} zero-width characters on one line (${hex(g.first.cp)} and others). That is not a stray paste: bits can be written in them, and only a program sees it.${where}`
          : `${what} of zero width (${hex(g.first.cp)}), which a person cannot see and which can split a word so that a search does not find it.${where}`,
        suggestion: "Delete them.",
      });
    } else if (kind === "bidi") {
      out.push({
        ...base,
        severity: "warning",
        confidence: "medium",
        message: `${what} that change the direction of text (${hex(g.first.cp)}). A line can read one way on screen and another way to a program.${where}`,
        suggestion: "Delete them unless the text really is written right to left.",
      });
    } else if (kind === "control") {
      const escape = g.first.cp === 0x1b;
      out.push({
        ...base,
        severity: "warning",
        confidence: "high",
        message: escape
          ? `${what} of control, starting with an escape (${hex(g.first.cp)}). In a terminal an escape sequence can hide the text before it or print something else, so \`cat\` shows another file than the agent reads.${where}`
          : `${what} of control (${hex(g.first.cp)}), which belong in no instruction file.${where}`,
        suggestion: "Delete them.",
      });
    } else {
      out.push({
        ...base,
        severity: "warning",
        confidence: "medium",
        message: `${what} of invisible variation selectors (${hex(g.first.cp)}), which draw nothing and can carry bytes.${where}`,
        suggestion: "Delete them.",
      });
    }
  }
  return out;
}

// The sentences that attacks on agents are made of. Matched on text with no case, emphasis or extra spaces.
const INJECTION: [RegExp, string][] = [
  [
    /\bignore (?:all |any |the |your )?(?:previous|prior|above|earlier|preceding) (?:instructions?|prompts?|rules?|directions?|messages?)\b/,
    "ignore previous instructions",
  ],
  [
    /\bdisregard (?:all |any |the |your )?(?:previous|prior|above|earlier|preceding|system) (?:instructions?|prompts?|rules?)\b/,
    "disregard previous instructions",
  ],
  [
    /\bforget (?:all |everything |your )?(?:previous|prior|above|earlier) (?:instructions?|rules?|context)\b/,
    "forget previous instructions",
  ],
  [
    /\b(?:do not|don'?t|never) (?:tell|inform|mention|reveal|show|let) (?:this to |any of this to )?(?:the )?(?:user|human|developer|operator)\b/,
    "do not tell the user",
  ],
  [/\bwithout (?:the user|the developer|anyone) (?:knowing|noticing|being told)\b/, "without the user knowing"],
  [/\byou are now (?:in )?(?:dan|developer mode|jailbroken|unrestricted)\b/, "you are now unrestricted"],
];

function plain(text: string): string {
  return text.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
}

function injectionIn(text: string): string | null {
  const t = plain(text);
  for (const [re, name] of INJECTION) if (re.test(t)) return name;
  return null;
}

function injections(doc: Doc): Finding[] {
  const out: Finding[] = [];
  // In an HTML comment it is hidden on GitHub and read by the agent. In text that shows it may be a file about attacks.
  for (const c of doc.md.comments) {
    const name = injectionIn(c.text);
    if (name)
      out.push({
        file: doc.file.path,
        line: c.line,
        column: 1,
        rule: "prompt-injection",
        severity: "warning",
        confidence: "medium",
        subject: name,
        message: `An HTML comment says "${name}". A comment is not shown on GitHub, and an agent reads it, which is how an instruction is hidden from the person who reviews the file.`,
        suggestion: "Delete the comment, or find out who wrote it.",
      });
  }
  for (const s of doc.md.statements) {
    const name = injectionIn(s.text);
    if (name)
      out.push({
        file: doc.file.path,
        line: s.line,
        column: 1,
        rule: "prompt-injection",
        severity: "warning",
        confidence: "low",
        subject: name,
        message: `The text says "${name}". That is how an attack on an agent is written, and it is also what a document about such attacks says.`,
      });
  }
  return out;
}

export function hiddenText(ctx: Context): Finding[] {
  return ctx.docs.flatMap((d) => [...invisibleIn(d), ...injections(d)]);
}
