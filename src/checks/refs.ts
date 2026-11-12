import type { Context, Doc } from "../analyze.js";
import type { Evidence } from "../git.js";
import { type ParsedMarkdown, parseMarkdown } from "../markdown.js";
import { resolveRelative } from "../paths.js";
import type { Finding } from "../types.js";

// Checks that what an instruction file points at is still there: paths, links, anchors and imports.

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "text", "txt", "plain"]);

const KNOWN_EXT = new Set(
  "ts tsx js jsx mjs cjs json md mdx yml yaml toml py go rs java kt swift rb php sh sql css scss html txt lock cfg ini env xml gradle proto vue svelte".split(
    " ",
  ),
);

// A bare file name such as "package.json" is checked only for these extensions. Names like "Node.js" or "Next.js" look
// like files and are not, so the JavaScript family needs a name that is clearly a file.
const BARE_EXT = new Set(
  "ts tsx json md yml yaml toml py go rs sh sql css html txt lock cfg ini mjs cjs java kt rb php swift xml".split(" "),
);
const BARE_JS = /(config|rc|setup|index|main|app|server|worker)\.[cm]?js$/i;

// Folders that hold build output or local state. A path into one of them is rarely in the repository, and that is no mistake.
// Words that mark an example path rather than a real one: "path/to/file", "your-app", "foo/bar".
const PLACEHOLDER = /(^|\/)(path\/to|your[-_][\w.-]*|my[-_][\w.-]*|foo|bar|baz|xxx|example)(\/|\.|$)/i;

// A line that says it writes, creates or installs something is naming a place the tool puts files, often in someone else's
// repository, and not a file that this one should have.
const PRODUCES =
  /\b(writes?|writing|creates?|creating|generates?|generating|installs?|installing|drops?|emits?|outputs?|produces?|per-repo)\b/i;

const GENERATED = new Set([
  "dist",
  "build",
  "out",
  "coverage",
  "node_modules",
  ".next",
  ".nuxt",
  "target",
  "tmp",
  "temp",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
]);

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function describe(ev: Evidence): string {
  const when = `in ${ev.commit} on ${ev.date}`;
  return ev.kind === "renamed" ? `It was renamed to \`${ev.to}\` ${when}.` : `It was deleted ${when}.`;
}

interface Candidate {
  path: string;
  isDir: boolean;
  bare: boolean;
  line: number;
  column: number;
  /** Where the path was written, which decides how much to trust that it is meant literally. */
  inFence: boolean;
}

function looksLikeTree(lines: string[]): boolean {
  return lines.some((l) => /[├└│]/.test(l) || /^\s*[|`]--/.test(l));
}

export function candidatesIn(
  text: string,
  line: number,
  baseColumn: number,
  inFence: boolean,
  hasTopLevel: (s: string) => boolean,
): Candidate[] {
  if (/<[^>\s]*>/.test(text)) return []; // a placeholder such as <name> means the text is a template
  const out: Candidate[] = [];
  for (const m of text.matchAll(/[^\s"'`,;()<>|&=]+/g)) {
    // Wildcards and Go-style "./..." patterns are judged before trailing dots are trimmed, or "./pkg/..." would lose its mark.
    if (/\.\.\.|…/.test(m[0])) continue;
    // "tests/a.py::test_x" is a test id. The file is what is worth checking.
    let t = (m[0].split("::")[0] as string).replace(/[.,:;!?)]+$/, "");
    t = t.replace(/(:\d+){1,2}$/, "").replace(/#L\d+(-L?\d+)?$/, "");
    if (t === "" || t.startsWith("-")) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(git@|mailto:|data:|file:)/.test(t)) continue;
    if (/[*?{}$%^\\!]/.test(t)) continue; // wildcards, templates and variables
    if (t.startsWith("/") || t.startsWith("~") || t.startsWith("@") || /^[A-Za-z]:[\\/]/.test(t)) continue;

    const isDir = t.endsWith("/");
    const p = t.replace(/\/+$/, "");
    if (p === "" || p === "." || p === "..") continue;
    const segments = p.split("/");
    const last = segments[segments.length - 1] as string;
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(last)?.[1]?.toLowerCase();
    if (ext !== undefined && last.length === ext.length + 1) continue; // ".md" or ".css" alone names a kind of file, not a file
    const hasSlash = segments.length > 1;

    let qualifies: boolean;
    if (hasSlash) {
      const first = segments[0] as string;
      qualifies =
        isDir || (ext !== undefined && KNOWN_EXT.has(ext)) || first === "." || first === ".." || hasTopLevel(first);
    } else if (isDir) {
      qualifies = hasTopLevel(p) || !p.includes(".");
    } else {
      qualifies = ext !== undefined && (BARE_EXT.has(ext) || (/^[cm]?jsx?$/.test(ext) && BARE_JS.test(last)));
    }
    if (!qualifies) continue;
    out.push({ path: p, isDir, bare: !hasSlash && !isDir, line, column: baseColumn + (m.index ?? 0), inFence });
  }
  return out;
}

function sourcesOf(doc: Doc, hasTopLevel: (s: string) => boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const span of doc.md.codeSpans)
    out.push(...candidatesIn(span.text, span.line, span.column + 1, false, hasTopLevel));
  for (const fence of doc.md.fences) {
    if (!SHELL_LANGS.has(fence.lang) || looksLikeTree(fence.lines.map((l) => l.text))) continue;
    for (const l of fence.lines) {
      if (l.text.trimStart().startsWith("#")) continue; // a comment in a shell block
      out.push(...candidatesIn(l.text, l.line, 1, true, hasTopLevel));
    }
  }
  return out;
}

/** Paths in code spans and shell blocks that no longer exist. */
export function stalePaths(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  for (const doc of ctx.docs) {
    const seen = new Set<string>();
    for (const c of sourcesOf(doc, ctx.index.hasTopLevel)) {
      const key = `${c.line}:${c.path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const rootOnly = c.path.startsWith("./") || c.path.startsWith("../");
      const bases = rootOnly ? [doc.file.dir] : [...new Set(["", doc.file.dir])];
      const resolved = bases.map((b) => resolveRelative(b, c.path)).filter((p): p is string => p !== null);
      if (resolved.length === 0) continue;
      const exists = (p: string): boolean => ctx.index.hasFile(p) || ctx.index.hasDir(p);
      if (resolved.some(exists)) continue;
      if (c.bare && ctx.index.byBasename(c.path).length > 0) continue;
      if (resolved.some((p) => GENERATED.has(p.split("/")[0] as string))) continue;
      if (PLACEHOLDER.test(c.path)) continue;
      if (PRODUCES.test(doc.md.lines[c.line - 1] ?? "")) continue;
      if (ctx.index.ignored(resolved).size > 0) continue;

      const base: Pick<Finding, "file" | "line" | "column" | "subject"> = {
        file: doc.file.path,
        line: c.line,
        column: c.column,
        subject: c.path,
      };
      const caseHit = resolved.map((p) => ctx.index.caseMatch(p)).find((p): p is string => p !== undefined);
      if (caseHit) {
        findings.push({
          ...base,
          rule: "stale-path",
          severity: "warning",
          confidence: "high",
          message: `\`${c.path}\` differs only in capitals from \`${caseHit}\`, so it breaks on a case-sensitive file system.`,
          suggestion: `Write \`${caseHit}\`.`,
        });
        continue;
      }

      if (c.bare) {
        // A bare name such as settings.json is too often something outside the repository, like a user's own settings, to
        // report on its own. It is reported only when Git remembers a file of that name that is gone.
        const was = ctx.history.lookupName(c.path);
        if (was) {
          const moved = was.kind === "renamed" ? `renamed to \`${was.to}\`` : "deleted";
          findings.push({
            ...base,
            rule: "stale-path",
            severity: "warning",
            confidence: "medium",
            message: `\`${c.path}\` is not in this repository now. A file of that name was ${moved} in ${was.commit} on ${was.date} (it was \`${was.path}\`).`,
          });
        }
        continue;
      }
      const evidence = resolved.map((p) => ctx.history.lookup(p)).find((e) => e !== undefined);
      if (evidence) {
        findings.push({
          ...base,
          rule: "stale-path",
          severity: "error",
          confidence: "high",
          message: `\`${c.path}\` does not exist. ${describe(evidence)}`,
          ...(evidence.kind === "renamed" && evidence.to ? { suggestion: `Point at \`${evidence.to}\` instead.` } : {}),
        });
        continue;
      }

      const first = resolved[0] as string;
      const parentExists = ctx.index.hasDir(dirOf(first)) && dirOf(first) !== "";
      const topExists = ctx.index.hasTopLevel(first.split("/")[0] as string);
      const confident = parentExists || topExists;
      findings.push({
        ...base,
        rule: "stale-path",
        severity: confident ? "warning" : "info",
        confidence: confident ? "medium" : "low",
        message: `\`${c.path}\` does not exist in this repository.`,
      });
    }
  }
  return findings;
}

function slugsOf(md: ParsedMarkdown): Set<string> {
  // GitHub gives a repeated heading the anchors "x", "x-1", "x-2".
  const counts = new Map<string, number>();
  const out = new Set<string>();
  for (const h of md.headings) {
    const n = counts.get(h.slug) ?? 0;
    counts.set(h.slug, n + 1);
    out.add(n === 0 ? h.slug : `${h.slug}-${n}`);
  }
  return out;
}

/** Links to files and headings that are gone. */
export function staleLinks(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const cache = new Map<string, ParsedMarkdown>();
  const headingsOf = (path: string): Set<string> | null => {
    if (!ctx.index.hasFile(path)) return null;
    let md = cache.get(path);
    if (!md) {
      md = parseMarkdown(ctx.index.read(path));
      cache.set(path, md);
    }
    return slugsOf(md);
  };

  for (const doc of ctx.docs) {
    const ownSlugs = slugsOf(doc.md);
    for (const link of doc.md.links) {
      const t = link.target;
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[A-Za-z]:[\\/]/.test(t)) continue; // http:, mailto: and the like
      const [withoutAnchor = "", anchorRaw] = t.split("#", 2) as [string, string | undefined];
      const pathPart = withoutAnchor.split("?")[0] as string;
      let anchor: string | undefined;
      try {
        anchor = anchorRaw === undefined ? undefined : decodeURIComponent(anchorRaw).toLowerCase();
      } catch {
        anchor = anchorRaw?.toLowerCase();
      }
      const base = { file: doc.file.path, line: link.line, column: link.column, subject: t };

      if (pathPart === "") {
        if (anchor && !ownSlugs.has(anchor)) {
          findings.push({
            ...base,
            rule: "stale-anchor",
            severity: "warning",
            confidence: "medium",
            message: `The link \`${t}\` points at a heading that is not in this file.`,
          });
        }
        continue;
      }
      let decoded = pathPart;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        // keep the text as written
      }
      const target = decoded.startsWith("/") ? resolveRelative("", decoded) : resolveRelative(doc.file.dir, decoded);
      if (target === null) continue;
      if (ctx.index.hasFile(target) || ctx.index.hasDir(target)) {
        if (anchor && target.endsWith(".md")) {
          const slugs = headingsOf(target);
          if (slugs && !slugs.has(anchor)) {
            findings.push({
              ...base,
              rule: "stale-anchor",
              severity: "warning",
              confidence: "medium",
              message: `The link \`${t}\` points at a heading that is not in \`${target}\`.`,
            });
          }
        }
        continue;
      }
      if (ctx.index.ignored([target]).size > 0) continue;
      const evidence = ctx.history.lookup(target);
      findings.push({
        ...base,
        rule: "stale-link",
        severity: "error",
        confidence: "high",
        message: `The link \`${t}\` points at ${target === pathPart ? "a file" : `\`${target}\``} that does not exist.${evidence ? ` ${describe(evidence)}` : ""}`,
        ...(evidence?.kind === "renamed" && evidence.to ? { suggestion: `Point at \`${evidence.to}\` instead.` } : {}),
      });
    }
  }
  return findings;
}

const IMPORT_KINDS = new Set(["claude", "gemini"]);
const MAX_IMPORT_DEPTH = 5;

/** "@path" imports that point at nothing, loop back on themselves, or nest deeper than the agent follows. */
export function staleImports(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const importsCache = new Map<string, { target: string; line: number; column: number }[]>();
  const importsOf = (path: string): { target: string; line: number; column: number }[] => {
    let list = importsCache.get(path);
    if (!list) {
      const doc = ctx.docs.find((d) => d.file.path === path);
      list = (doc ? doc.md : ctx.index.hasFile(path) ? parseMarkdown(ctx.index.read(path)) : { imports: [] }).imports;
      importsCache.set(path, list);
    }
    return list;
  };

  const reported = new Set<string>();
  const report = (f: Finding): void => {
    const key = `${f.rule}:${f.file}:${f.line}:${f.column}`;
    if (!reported.has(key)) {
      reported.add(key);
      findings.push(f);
    }
  };

  const visit = (path: string, stack: string[]): void => {
    for (const imp of importsOf(path)) {
      if (imp.target.startsWith("~/")) continue;
      const target = resolveRelative(dirOf(path), imp.target);
      if (target === null) continue;
      const base = { file: path, line: imp.line, column: imp.column, subject: `@${imp.target}` };
      if (!ctx.index.hasFile(target)) {
        const evidence = ctx.history.lookup(target);
        report({
          ...base,
          rule: "stale-import",
          severity: "error",
          confidence: "high",
          message: `\`@${imp.target}\` imports ${target === imp.target ? "a file" : `\`${target}\``} that does not exist.${evidence ? ` ${describe(evidence)}` : ""}`,
          ...(evidence?.kind === "renamed" && evidence.to ? { suggestion: `Import \`${evidence.to}\` instead.` } : {}),
        });
        continue;
      }
      if (stack.includes(target)) {
        report({
          ...base,
          rule: "import-cycle",
          severity: "warning",
          confidence: "high",
          message: `\`@${imp.target}\` loops back to \`${target}\`, which is already being read.`,
        });
        continue;
      }
      if (stack.length > MAX_IMPORT_DEPTH) {
        // the stack holds the file itself, so this is the sixth hop
        report({
          ...base,
          rule: "import-depth",
          severity: "warning",
          confidence: "high",
          message: `\`@${imp.target}\` is nested more than ${MAX_IMPORT_DEPTH} imports deep, so the agent stops following it.`,
        });
        continue;
      }
      visit(target, [...stack, target]);
    }
  };

  for (const doc of ctx.docs) {
    if (IMPORT_KINDS.has(doc.file.kind)) visit(doc.file.path, [doc.file.path]);
  }
  return findings;
}
