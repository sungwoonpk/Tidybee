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

/** The part of a regular expression for a glob, with no anchors. Braces may be nested. */
function body(g: string): string {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === "*") {
      if (g[i + 1] === "*") {
        const slash = g[i + 2] === "/";
        i += slash ? 2 : 1;
        re += slash ? "(?:.*/)?" : ".*";
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const close = closingBrace(g, i);
      if (close < 0) {
        re += "\\{";
      } else {
        re += `(?:${splitTop(g.slice(i + 1, close))
          .map(body)
          .join("|")})`;
        i = close;
      }
    } else if (c === "[") {
      const close = g.indexOf("]", i + 1);
      if (close < 0) {
        re += "\\[";
      } else {
        re += `[${g.slice(i + 1, close).replace(/^!/, "^")}]`;
        i = close;
      }
    } else {
      re += c.replace(/[.+^$()|\\}]/g, "\\$&");
    }
  }
  return re;
}

/**
 * Turns a glob such as "src/**\/*.ts" into a test for paths. It knows `*` (not across folders), `**` (across folders), `?`,
 * `{a,b}` with braces inside braces, and `[abc]`, which is what the rule files of Cursor, Windsurf and Copilot use. A pattern
 * with no slash matches the name in any folder, as it does in a .gitignore, and a pattern ending in a slash matches everything
 * under that folder.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim();
  if (g.startsWith("./")) g = g.slice(2);
  const anywhere = !g.includes("/");
  if (g.endsWith("/")) g += "**";
  return new RegExp(`^${anywhere ? "(?:.*/)?" : ""}${body(g)}$`);
}

/** Splits a list of globs written as one string with commas, as Copilot's applyTo is. Commas inside braces stay. */
export function splitGlobs(value: string): string[] {
  return splitTop(value)
    .map((g) => g.trim())
    .filter((g) => g !== "");
}

/** How many of the files any of the globs matches. */
export function countMatches(globs: string[], files: string[]): number {
  const res = globs.map(globToRegExp);
  let n = 0;
  for (const f of files) if (res.some((r) => r.test(f))) n++;
  return n;
}
