// Glob matching for the rule files of Cursor, Windsurf and Copilot. It does not build regular expressions. A pattern is
// untrusted text from a repository, and so are the paths it is matched against, so a pattern such as "**/**/**/x" or
// "*a*a*a*b" must not be able to make a regular expression backtrack for ever. Matching here is by dynamic programming
// over path segments and a greedy walk inside a segment, which cost a fixed amount for the size of the input.

/** Longest glob that is looked at. A longer one is not judged. */
const MAX_GLOB_LENGTH = 300;
/** Most patterns a glob with braces may expand to. A glob that expands to more is not judged. */
const MAX_ALTERNATIVES = 64;

export type Matcher = (path: string) => boolean;

/** The index of the "}" that closes the "{" at `open`, counting nested braces, or -1. */
function closingBrace(g: string, open: number): number {
  let depth = 0;
  for (let i = open; i < g.length; i++) {
    if (g[i] === "{") depth++;
    else if (g[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Splits at the commas that are not inside braces. */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of value) {
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

/** Writes out every choice in `{a,b}`, braces inside braces included. Returns null if there would be too many. */
function expandBraces(g: string): string[] | null {
  const open = g.indexOf("{");
  if (open < 0) return [g];
  const close = closingBrace(g, open);
  if (close < 0) return [g]; // a brace that never closes is just a character
  const prefix = g.slice(0, open);
  const suffixes = expandBraces(g.slice(close + 1));
  if (suffixes === null) return null;
  const out: string[] = [];
  for (const alternative of splitTop(g.slice(open + 1, close))) {
    const inner = expandBraces(alternative);
    if (inner === null) return null;
    for (const a of inner) {
      for (const s of suffixes) {
        out.push(prefix + a + s);
        if (out.length > MAX_ALTERNATIVES) return null;
      }
    }
  }
  return out;
}

/** Whether one character is matched by the single-character piece of a pattern at `p`, and where the pattern goes on. */
function piece(pat: string, p: number, ch: string): { matched: boolean; next: number } {
  const c = pat[p] as string;
  if (c === "?") return { matched: true, next: p + 1 };
  if (c === "[") {
    const close = pat.indexOf("]", p + 2);
    if (close > 0) {
      let body = pat.slice(p + 1, close);
      const negate = body.startsWith("!") || body.startsWith("^");
      if (negate) body = body.slice(1);
      let hit = false;
      for (let i = 0; i < body.length; i++) {
        if (body[i + 1] === "-" && i + 2 < body.length) {
          if (ch >= (body[i] as string) && ch <= (body[i + 2] as string)) hit = true;
          i += 2;
        } else if (body[i] === ch) {
          hit = true;
        }
      }
      return { matched: hit !== negate, next: close + 1 };
    }
  }
  return { matched: c === ch, next: p + 1 };
}

/** Matches one path segment against one pattern segment, with `*`, `?` and `[abc]`. */
function segmentMatches(pat: string, str: string): boolean {
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < str.length) {
    if (p < pat.length && pat[p] === "*") {
      star = p++;
      mark = s;
      continue;
    }
    if (p < pat.length) {
      const r = piece(pat, p, str[s] as string);
      if (r.matched) {
        p = r.next;
        s++;
        continue;
      }
    }
    if (star < 0) return false;
    p = star + 1;
    s = ++mark;
  }
  while (p < pat.length && pat[p] === "*") p++;
  return p === pat.length;
}

/** Matches path segments against pattern segments, where a `**` segment stands for any number of segments. */
function pathMatches(pats: string[], segs: string[]): boolean {
  const cols = segs.length + 1;
  // dp[i][j] is true when pats[i..] matches segs[j..], filled from the end.
  let next = new Array<boolean>(cols).fill(false);
  next[segs.length] = true;
  for (let i = pats.length - 1; i >= 0; i--) {
    const row = new Array<boolean>(cols).fill(false);
    const pat = pats[i] as string;
    for (let j = segs.length; j >= 0; j--) {
      if (pat === "**") row[j] = (next[j] as boolean) || (j < segs.length && (row[j + 1] as boolean));
      else row[j] = j < segs.length && (next[j + 1] as boolean) && segmentMatches(pat, segs[j] as string);
    }
    next = row;
  }
  return next[0] as boolean;
}

/**
 * Prepares a glob such as "src/**\/*.ts" for matching paths, or returns null for one that is too long or has too many
 * choices to be judged. It knows `*` (not across folders), `**` (across folders), `?`, `{a,b}` with braces inside braces, and
 * `[abc]`. A pattern with no slash matches the name in any folder, as in a .gitignore, a pattern ending in a slash matches
 * everything under that folder, and a leading slash fixes it to the root.
 */
export function compileGlob(glob: string): Matcher | null {
  let g = glob.trim();
  if (g === "" || g.length > MAX_GLOB_LENGTH) return null;
  if (g.startsWith("./")) g = g.slice(2);
  let anywhere = !g.includes("/");
  if (g.startsWith("/")) {
    g = g.slice(1);
    anywhere = false;
  }
  if (g.endsWith("/")) g += "**";
  const alternatives = expandBraces(g);
  if (alternatives === null) return null;
  const patterns = alternatives.map((alt) => {
    const segs = alt.split("/").filter((s) => s !== "");
    if (anywhere) segs.unshift("**");
    // Several "**" in a row mean the same as one, and one is much cheaper.
    return segs.filter((s, i) => !(s === "**" && segs[i - 1] === "**"));
  });
  return (path) => {
    const segs = path.split("/");
    return patterns.some((p) => pathMatches(p, segs));
  };
}

/** Splits a list of globs written as one string with commas, as Copilot's applyTo is. Commas inside braces stay. */
export function splitGlobs(value: string): string[] {
  return splitTop(value)
    .map((g) => g.trim())
    .filter((g) => g !== "");
}

/**
 * Whether any of the files is matched by any of the globs. It is undefined when a glob is too long or too involved to be
 * judged, so that a caller does not report "matches nothing" for a pattern it could not read.
 */
export function anyMatch(globs: string[], files: string[]): boolean | undefined {
  const matchers = globs.map(compileGlob);
  if (matchers.some((m) => m === null)) return undefined;
  const ms = matchers as Matcher[];
  return files.some((f) => ms.some((m) => m(f)));
}

/** How many of the files any of the globs matches, or -1 when a glob cannot be judged. */
export function countMatches(globs: string[], files: string[]): number {
  const matchers = globs.map(compileGlob);
  if (matchers.some((m) => m === null)) return -1;
  const ms = matchers as Matcher[];
  return files.filter((f) => ms.some((m) => m(f))).length;
}
