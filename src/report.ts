import type { Report } from "./engine.js";
import type { Severity } from "./types.js";

export interface RenderOptions {
  color: boolean;
  /** How many findings were hidden by the confidence setting, to tell the reader. */
  showHiddenHint: boolean;
}

const SGR: Record<string, string> = { bold: "1", dim: "2", red: "31", yellow: "33", cyan: "36", green: "32" };

function paint(on: boolean, style: string, text: string): string {
  return on ? `\x1b[${SGR[style]}m${text}\x1b[0m` : text;
}

const SEVERITY_STYLE: Record<Severity, string> = { error: "red", warning: "yellow", info: "cyan" };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The report as text for a person to read in a terminal. */
export function renderText(report: Report, options: RenderOptions): string {
  const c = options.color;
  const lines: string[] = [];

  if (report.files.length === 0) {
    return "No instruction files found. Tidybee looks for CLAUDE.md, AGENTS.md, GEMINI.md, Cursor, Windsurf, Cline and Copilot rules, and Claude skills, commands and agents.\n";
  }

  let current = "";
  for (const f of report.findings) {
    if (f.file !== current) {
      if (current !== "") lines.push("");
      lines.push(paint(c, "bold", f.file));
      current = f.file;
    }
    const where = `${f.line}:${f.column}`.padEnd(7);
    lines.push(
      `  ${paint(c, "dim", where)} ${paint(c, SEVERITY_STYLE[f.severity], f.severity.padEnd(7))} ${f.message} ${paint(c, "dim", f.rule)}`,
    );
    if (f.suggestion) lines.push(`          ${paint(c, "green", "->")} ${f.suggestion}`);
  }
  if (report.findings.length > 0) lines.push("");

  const tokens = `about ${report.alwaysLoadedTokens.toLocaleString("en-US")} tokens read at the start of every session`;
  const scope = `${plural(report.files.length, "instruction file")}, ${tokens}`;
  if (report.findings.length === 0) {
    lines.push(`${paint(c, "green", "No problems found")} in ${scope}.`);
  } else {
    const parts = (["error", "warning", "info"] as const)
      .filter((s) => report.counts[s] > 0)
      .map((s) => plural(report.counts[s], s === "info" ? "note" : s));
    lines.push(`${plural(report.findings.length, "problem")} (${parts.join(", ")}) in ${scope}.`);
  }
  if (report.skippedFiles > 0) {
    lines.push(
      paint(
        c,
        "yellow",
        `${plural(report.files.length + report.skippedFiles, "instruction file")} were found and only the first ${report.files.length.toLocaleString("en-US")} were checked.`,
      ),
    );
  }
  if (report.hidden > 0 && options.showHiddenHint) {
    lines.push(
      paint(
        c,
        "dim",
        `${plural(report.hidden, "less certain finding")} not shown. Run with --all to see ${report.hidden === 1 ? "it" : "them"}.`,
      ),
    );
  }
  if (!report.usedGit) {
    lines.push(
      paint(
        c,
        "dim",
        "Git was not used, so ignored files are not skipped and the history of renamed files is not searched.",
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** The report as JSON for another program to read. The shape is versioned so that it can change without breaking readers silently. */
export function renderJson(report: Report): string {
  return `${JSON.stringify({ version: 1, ...report }, null, 2)}\n`;
}
