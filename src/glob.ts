/**
 * Turns a glob such as "src/**\/*.ts" into a test for paths. It knows `*` (not across folders), `**` (across folders), `?`,
 * `{a,b}` and `[abc]`, which is what the rule files of Cursor, Windsurf and Copilot use. A pattern with no slash matches the
 * name in any folder, as it does in a .gitignore, and a pattern ending in a slash matches everything under that folder.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim();
  if (g.startsWith("./")) g = g.slice(2);
  const anywhere = !g.includes("/");
  if (g.endsWith("/")) g += "**";
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
      const close = g.indexOf("}", i);
      if (close < 0) {
        re += "\\{";
      } else {
        const alternatives = g.slice(i + 1, close).split(",");
        re += `(?:${alternatives.map((a) => globToRegExp(a).source.slice(1, -1)).join("|")})`;
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
      re += c.replace(/[.+^$()|\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${anywhere ? "(?:.*/)?" : ""}${re}$`);
}

/** Splits a list of globs written as one string with commas, as Copilot's applyTo is. Commas inside braces stay. */
export function splitGlobs(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of value) {
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current.trim());
  return out.filter((g) => g !== "");
}

/** How many of the files any of the globs matches. */
export function countMatches(globs: string[], files: string[]): number {
  const res = globs.map(globToRegExp);
  let n = 0;
  for (const f of files) if (res.some((r) => r.test(f))) n++;
  return n;
}
