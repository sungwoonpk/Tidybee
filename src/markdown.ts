// A small Markdown reader that knows only what Tidybee needs: where the headings, links, code spans, code blocks and
// imports are, and on which line. It is not a full CommonMark parser, and it does not try to be. Lines and columns start at 1.

export interface CodeSpan {
  text: string;
  line: number;
  column: number;
}

export interface Link {
  text: string;
  target: string;
  line: number;
  column: number;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
  /** The anchor GitHub makes for it. */
  slug: string;
}

export interface FenceLine {
  text: string;
  line: number;
}

export interface Fence {
  /** The word after the opening fence, lower-cased. Empty when there is none. */
  lang: string;
  startLine: number;
  lines: FenceLine[];
}

export interface Import {
  /** The path after the "@". */
  target: string;
  line: number;
  column: number;
}

export type FrontmatterValue = string | boolean | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  /** The line of the closing "---". */
  endLine: number;
}

export interface ParsedMarkdown {
  lines: string[];
  frontmatter: Frontmatter | null;
  headings: Heading[];
  codeSpans: CodeSpan[];
  links: Link[];
  fences: Fence[];
  imports: Import[];
  /** Lines of text outside code blocks and frontmatter, with the line number of each. Code spans are blanked out. */
  prose: FenceLine[];
  /** The same lines as written, with their code spans. */
  body: FenceLine[];
  /** Sentences and list items, as plain text, with the line each starts on. Headings, tables and comments are left out. */
  statements: FenceLine[];
  /** HTML comments, which a reader of rendered Markdown does not see and an agent does. The text is the inside of the comment. */
  comments: FenceLine[];
}

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function parseScalar(raw: string): string | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Reads the block of "key: value" lines between two "---" lines at the top of a file. It understands plain values,
 * quoted values, booleans, "[a, b]" lists and "- item" lists, which is what Cursor rules and skills use.
 */
export function parseFrontmatter(lines: string[]): Frontmatter | null {
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const data: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? "";
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const current = data[listKey];
      const list = Array.isArray(current) ? current : [];
      list.push(String(parseScalar(item[1] ?? "")));
      data[listKey] = list;
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      listKey = null;
      continue;
    }
    const key = kv[1] as string;
    const value = (kv[2] ?? "").trim();
    if (value === "") {
      listKey = key;
      data[key] = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      listKey = null;
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => String(parseScalar(s)))
        .filter((s) => s !== "");
    } else {
      listKey = null;
      data[key] = parseScalar(value);
    }
  }
  return { data, endLine: end + 1 };
}

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;

/** The index of the next run of exactly `length` backticks at or after `from`, or -1. Longer or shorter runs do not count. */
function findClosingRun(text: string, from: number, length: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let run = 0;
    while (text[i + run] === "`") run++;
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/**
 * Finds `code spans` in one line of prose and returns the line with each span blanked out, so that a link or an import
 * written inside code is not mistaken for a real one.
 */
function codeSpansOf(text: string, line: number, into: CodeSpan[]): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      out += text[i];
      i++;
      continue;
    }
    let run = 0;
    while (text[i + run] === "`") run++;
    const end = findClosingRun(text, i + run, run);
    if (end < 0) {
      out += text.slice(i, i + run); // backticks that never close are plain text
      i += run;
      continue;
    }
    const inner = text.slice(i + run, end).replace(/^ (.*) $/, "$1");
    into.push({ text: inner, line, column: i + 1 });
    out += " ".repeat(end + run - i);
    i = end + run;
  }
  return out;
}

/** Reads Markdown text into the pieces Tidybee checks. */
export function parseMarkdown(source: string): ParsedMarkdown {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const frontmatter = parseFrontmatter(lines);
  const result: ParsedMarkdown = {
    lines,
    frontmatter,
    headings: [],
    codeSpans: [],
    links: [],
    fences: [],
    imports: [],
    prose: [],
    body: [],
    statements: [],
    comments: [],
  };

  let fence: { marker: string; fence: Fence } | null = null;
  const start = frontmatter ? frontmatter.endLine : 0;
  for (let i = start; i < lines.length; i++) {
    const text = lines[i] ?? "";
    const lineNo = i + 1;

    if (fence) {
      const close = new RegExp(`^\\s*${fence.marker[0] === "`" ? "`" : "~"}{${fence.marker.length},}\\s*$`);
      if (close.test(text)) {
        result.fences.push(fence.fence);
        fence = null;
      } else {
        fence.fence.lines.push({ text, line: lineNo });
      }
      continue;
    }
    const open = FENCE_OPEN.exec(text);
    if (open) {
      fence = {
        marker: open[2] as string,
        fence: { lang: (open[3] ?? "").toLowerCase(), startLine: lineNo, lines: [] },
      };
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (heading) {
      const headingText = (heading[2] as string).replace(/`([^`]*)`/g, "$1");
      result.headings.push({
        level: (heading[1] as string).length,
        text: headingText,
        line: lineNo,
        slug: slugify(headingText),
      });
    }

    const blanked = codeSpansOf(text, lineNo, result.codeSpans);
    result.prose.push({ text: blanked, line: lineNo });
    result.body.push({ text, line: lineNo });

    for (const m of blanked.matchAll(/!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      result.links.push({ text: m[1] ?? "", target: m[2] as string, line: lineNo, column: (m.index ?? 0) + 1 });
    }
    // "@path/to/file", as Claude Code reads it. A bare "@name" is a mention and not an import, so a slash or a dot is needed.
    for (const m of blanked.matchAll(/(?<![\w@/.:~-])@((?:~\/)?[\w.-]+(?:\/[\w.-]+)*)/g)) {
      const target = m[1] as string;
      if (!/[/.]/.test(target) || /\.$/.test(target)) continue;
      // An email address or a handle in a URL has a word character before the "@", and was skipped above.
      result.imports.push({ target, line: lineNo, column: (m.index ?? 0) + 1 });
    }
  }
  if (fence) result.fences.push(fence.fence); // an unclosed block runs to the end of the file
  const inComment = findComments(result.body, result.comments);
  result.statements = statementsOf(result.body, inComment);
  return result;
}

/** Finds HTML comments in the body, which may run over several lines. Returns the set of line numbers they cover. */
function findComments(body: FenceLine[], into: FenceLine[]): Set<number> {
  const covered = new Set<number>();
  let open: { line: number; parts: string[] } | null = null;
  for (const { text, line } of body) {
    let rest = text;
    let guard = 0;
    while (rest !== "" && guard++ < 50) {
      if (open) {
        const end = rest.indexOf("-->");
        covered.add(line);
        if (end < 0) {
          open.parts.push(rest);
          rest = "";
        } else {
          open.parts.push(rest.slice(0, end));
          into.push({ text: open.parts.join(" ").replace(/\s+/g, " ").trim(), line: open.line });
          open = null;
          rest = rest.slice(end + 3);
        }
      } else {
        const start = rest.indexOf("<!--");
        if (start < 0) break;
        covered.add(line);
        open = { line, parts: [] };
        rest = rest.slice(start + 4);
      }
    }
  }
  if (open) into.push({ text: open.parts.join(" ").replace(/\s+/g, " ").trim(), line: open.line });
  return covered;
}

/** Splits the body into the sentences and list items a person would call separate statements. */
function statementsOf(body: FenceLine[], skip: Set<number>): FenceLine[] {
  const out: FenceLine[] = [];
  let para: FenceLine[] = [];
  const flush = (): void => {
    if (para.length === 0) return;
    const text = para
      .map((p) => p.text.trim())
      .join(" ")
      .replace(/\s+/g, " ");
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z0-9`"'([])/)) {
      if (sentence.trim() !== "") out.push({ text: sentence.trim(), line: (para[0] as FenceLine).line });
    }
    para = [];
  };
  for (const { text, line } of body) {
    if (skip.has(line) || text.trim() === "") {
      flush();
      continue;
    }
    if (/^ {0,3}#{1,6}\s/.test(text) || /^\s*\|/.test(text) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      flush();
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(text);
    if (item) {
      flush();
      para = [{ text: (item[1] as string).replace(/^\[[ xX]\]\s+/, ""), line }];
      continue;
    }
    para.push({ text: text.replace(/^\s*>\s?/, ""), line });
  }
  flush();
  return out;
}
