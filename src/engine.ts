import { type Context, alwaysTokens, buildContext } from "./analyze.js";
import { staleCommands } from "./checks/commands.js";
import { contradictions } from "./checks/contradictions.js";
import { duplication } from "./checks/duplication.js";
import { headers } from "./checks/headers.js";
import { hiddenText } from "./checks/hidden.js";
import { quality } from "./checks/quality.js";
import { riskyCommands } from "./checks/risky.js";
import { secrets } from "./checks/secrets.js";
import { staleTrees } from "./checks/tree.js";
import { staleImports, stalePaths, staleLinks } from "./checks/refs.js";
import type { Confidence, Finding, Severity } from "./types.js";

export interface FileSummary {
  path: string;
  kind: string;
  load: string;
  tokens: number;
}

export interface Report {
  root: string;
  usedGit: boolean;
  files: FileSummary[];
  findings: Finding[];
  /** Estimated tokens an agent reads at the start of every session, from the files it always loads. */
  alwaysLoadedTokens: number;
  counts: Record<Severity, number>;
  /** How many instruction files were found beyond the limit and not checked. */
  skippedFiles: number;
  /** How many findings were left out for being less certain than the minimum asked for. */
  hidden: number;
}

export interface CheckOptions {
  /** Findings less certain than this are left out. The default is "medium". */
  minConfidence?: Confidence;
  useGit?: boolean;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export const CHECKS: ((ctx: Context) => Finding[])[] = [
  stalePaths,
  staleLinks,
  staleImports,
  staleCommands,
  staleTrees,
  headers,
  duplication,
  quality,
  contradictions,
  hiddenText,
  secrets,
  riskyCommands,
];

export function analyze(ctx: Context, options: CheckOptions = {}): Report {
  const min = CONFIDENCE_RANK[options.minConfidence ?? "medium"];
  const all = CHECKS.flatMap((check) => check(ctx));
  const findings = all
    .filter((f) => CONFIDENCE_RANK[f.confidence] >= min)
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    root: ctx.index.root,
    usedGit: ctx.index.usedGit,
    files: ctx.docs.map((d) => ({ path: d.file.path, kind: d.file.kind, load: d.load, tokens: d.tokens })),
    findings,
    alwaysLoadedTokens: ctx.docs.reduce((sum, d) => sum + alwaysTokens(d), 0),
    counts,
    skippedFiles: ctx.skippedDocs,
    hidden: all.length - findings.length,
  };
}

/** Reads the repository at root and checks every instruction file in it. */
export function check(root: string, options: CheckOptions = {}): Report {
  return analyze(buildContext(root, options.useGit === undefined ? {} : { useGit: options.useGit }), options);
}
