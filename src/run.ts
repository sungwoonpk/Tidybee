import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { check } from "./engine.js";
import { renderJson, renderText } from "./report.js";
import type { Confidence, Severity } from "./types.js";

export interface IO {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  /** True when the output is a terminal, so colors may be used. */
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

const HELP = `Tidybee checks the instruction files that coding agents read.

Usage:
  tidybee check [path] [options]

Options:
  --format <text|json>         How to print the result. Default: text.
  --fail-on <error|warning|never>
                               The lowest severity that makes the exit code 1. Default: error.
  --all                        Also show findings Tidybee is less sure about.
  --no-git                     Do not use Git, even in a repository.
  -v, --version                Print the version.
  -h, --help                   Print this help.

Exit codes: 0 when nothing at or above --fail-on was found, 1 when something was, 2 when the command could not run.
`;

function version(): string {
  // From the sources the file is one folder under the package, and from the build it is two.
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "tidybee" && pkg.version) return pkg.version;
    } catch {
      // try the next place
    }
  }
  return "unknown";
}

const FAIL_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/** Runs a command line and returns the exit code. */
export function run(argv: string[], io: IO): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
        "fail-on": { type: "string", default: "error" },
        all: { type: "boolean", default: false },
        "no-git": { type: "boolean", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    io.err(`tidybee: ${(e as Error).message}\nRun "tidybee --help" for usage.\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  if (values.version) {
    io.out(`tidybee ${version()}\n`);
    return 0;
  }

  const [command = "check", ...rest] = positionals;
  if (command !== "check") {
    io.err(`tidybee: unknown command "${command}". Run "tidybee --help" for usage.\n`);
    return 2;
  }
  if (rest.length > 1) {
    io.err("tidybee: check takes one path.\n");
    return 2;
  }
  const format = values.format as string;
  if (format !== "text" && format !== "json") {
    io.err(`tidybee: --format must be text or json, not "${format}".\n`);
    return 2;
  }
  const failOn = values["fail-on"] as string;
  if (failOn !== "error" && failOn !== "warning" && failOn !== "never") {
    io.err(`tidybee: --fail-on must be error, warning or never, not "${failOn}".\n`);
    return 2;
  }

  const root = resolve(io.cwd, rest[0] ?? ".");
  let report;
  try {
    const minConfidence: Confidence = values.all ? "low" : "medium";
    report = check(root, { minConfidence, useGit: !values["no-git"] });
  } catch (e) {
    io.err(`tidybee: ${(e as Error).message}\n`);
    return 2;
  }

  const color = io.isTTY && io.env.NO_COLOR === undefined && io.env.TERM !== "dumb";
  io.out(format === "json" ? renderJson(report) : renderText(report, { color, showHiddenHint: !values.all }));

  if (failOn === "never") return 0;
  const threshold = FAIL_RANK[failOn] as number;
  const bad = report.findings.some((f) => FAIL_RANK[f.severity as Severity]! <= threshold);
  return bad ? 1 : 0;
}
