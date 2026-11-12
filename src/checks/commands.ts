import type { Context, Doc } from "../analyze.js";
import type { Manager } from "../project.js";
import type { Finding } from "../types.js";

// Checks the commands an instruction file tells the agent to run against what the repository really offers.

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "text", "txt", "plain"]);

// Words after the program name that are commands of the package manager itself, so they are not names of scripts.
const BUILTINS: Record<Manager, Set<string>> = {
  npm: new Set(
    "access adduser audit bugs cache ci completion config dedupe deprecate diff dist-tag docs doctor edit exec explain explore find-dupes fund get help hook i init install install-ci-test install-test it link ln login logout ls org outdated owner pack ping pkg prefix profile prune publish query rebuild repo restart root run run-script search set shrinkwrap star stars stop team token uninstall unpublish unstar update version view whoami x".split(
      " ",
    ),
  ),
  pnpm: new Set(
    "add audit bin config c create dedupe deploy dlx doctor env exec fetch i import init install install-test licenses link list ln ls outdated pack patch patch-commit patch-remove prune publish rebuild recursive remove rm root run self-update server setup store uninstall unlink up update why".split(
      " ",
    ),
  ),
  yarn: new Set(
    "add audit autoclean bin cache check config constraints create dedupe dlx exec explain generate-lock-entry global help import info init install licenses link list login logout node outdated owner pack plugin publish rebuild remove run set tag team unlink unplug up upgrade upgrade-interactive version versions why workspace workspaces".split(
      " ",
    ),
  ),
  bun: new Set(
    "add build create dev exec init install link outdated pm remove repl run test unlink update upgrade x i a rm".split(
      " ",
    ),
  ),
};

const NODE_MANAGERS = new Set<string>(["npm", "pnpm", "yarn", "bun"]);

// Options that choose which package or folder a command runs in. A command that uses one is not checked against every script.
const SCOPING =
  /^(--filter|-F|-r|--recursive|--workspace|-w|--workspaces|--prefix|-C|--dir|--cwd|--workspace-root)(=|$)/;

interface Command {
  tokens: string[];
  line: number;
  column: number;
  inFence: boolean;
}

/** Splits one line of shell into the separate commands it runs, without the prompt, comments and variable settings. */
export function commandsIn(text: string): string[][] {
  const out: string[][] = [];
  const withoutComment = text.replace(/\s#\s.*$/, "");
  for (const part of withoutComment.split(/&&|\|\||;|\|/)) {
    let s = part.trim().replace(/^[$>]\s+/, "");
    s = s.replace(/^(?:sudo\s+|time\s+|exec\s+)+/, "");
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, "");
    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) out.push(tokens);
  }
  return out;
}

function commandsOf(doc: Doc): Command[] {
  const out: Command[] = [];
  const add = (text: string, line: number, column: number, inFence: boolean): void => {
    if (/<[^>\s]*>/.test(text)) return; // a placeholder means this is a template
    for (const tokens of commandsIn(text)) out.push({ tokens, line, column, inFence });
  };
  for (const span of doc.md.codeSpans) add(span.text, span.line, span.column + 1, false);
  for (const fence of doc.md.fences) {
    if (!SHELL_LANGS.has(fence.lang)) continue;
    for (const l of fence.lines) {
      if (!l.text.trimStart().startsWith("#")) add(l.text, l.line, 1, true);
    }
  }
  return out;
}

/** Picks the script name from the words after "npm", "pnpm", "yarn" or "bun", or returns null when the command is not one that runs a script. */
export function scriptOf(runner: Manager, args: string[]): { script: string; viaRun: boolean } | null {
  if (args.some((a) => SCOPING.test(a))) return null;
  const words = args.filter((a) => !a.startsWith("-"));
  const first = words[0];
  if (first === undefined) return null;
  if (first === "run" || first === "run-script") {
    const name = words[1];
    return name ? { script: name, viaRun: true } : null;
  }
  if (first === "test" || first === "t" || first === "tst")
    return runner === "bun" ? null : { script: "test", viaRun: false };
  if (first === "start") return { script: "start", viaRun: false };
  if (runner === "npm" || runner === "bun") return null; // "npm foo" does not run a script
  if (BUILTINS[runner].has(first) || /[./]/.test(first)) return null;
  return { script: first, viaRun: false }; // "pnpm build" and "yarn build" run the script
}

const INSTALL_WORDS = new Set(["install", "i", "ci", "add", "run", "test", "start", "build", "dev"]);

/** Commands that name a script, a make target or a recipe that does not exist, and package managers the repository does not use. */
export function staleCommands(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const { project } = ctx;
  for (const doc of ctx.docs) {
    const seen = new Set<string>();
    for (const cmd of commandsOf(doc)) {
      const [program = "", ...args] = cmd.tokens;
      const subject = cmd.tokens.join(" ");
      const key = `${cmd.line}:${subject}`;
      if (seen.has(key)) continue;
      const base = { file: doc.file.path, line: cmd.line, column: cmd.column, subject };
      const confidence = cmd.inFence ? "high" : "medium";
      const severity = cmd.inFence ? "error" : "warning";
      const add = (
        f: Omit<Finding, "file" | "line" | "column" | "subject" | "confidence" | "severity"> &
          Partial<Pick<Finding, "confidence" | "severity">>,
      ): void => {
        seen.add(key);
        findings.push({ confidence, severity, ...base, ...f });
      };

      if (NODE_MANAGERS.has(program)) {
        const runner = program as Manager;
        const global = args.includes("-g") || args.includes("--global");
        const manager = project.managerFor(doc.file.dir);
        const word = args.find((a) => !a.startsWith("-"));
        if (!global && manager && manager !== runner && word && INSTALL_WORDS.has(word)) {
          add({
            rule: "package-manager",
            severity: "warning",
            message: `Uses ${runner}, but this repository's lockfile is ${manager}'s.`,
            suggestion: `Use ${manager}.`,
          });
          continue;
        }
        const s = scriptOf(runner, args);
        if (!s || global) continue;
        if (!project.hasPackageJson) {
          add({
            rule: "stale-command",
            message: `\`${subject}\` runs a script, but this repository has no package.json.`,
          });
        } else if (!project.scripts.has(s.script) && !(s.script === "start" && project.hasDefaultStart)) {
          add({
            rule: "stale-command",
            message: `\`${subject}\` runs the script \`${s.script}\`, which no package.json in this repository defines.`,
          });
        }
      } else if (program === "make") {
        if (args.some((a) => a === "-C" || a === "-f" || a.startsWith("--directory") || a.startsWith("--file")))
          continue;
        const targets = args.filter((a) => !a.startsWith("-") && !a.includes("="));
        if (targets.length === 0) continue;
        if (!project.hasMakefile) {
          add({ rule: "stale-command", message: `\`${subject}\` needs a Makefile, and this repository has none.` });
          continue;
        }
        const missing = targets.filter((t) => !project.makeTargets.has(t));
        if (missing.length > 0) {
          add({
            rule: "stale-command",
            message: `\`${subject}\` names ${missing.map((m) => `\`${m}\``).join(", ")}, which no Makefile defines.`,
          });
        }
      } else if (program === "just") {
        const recipe = args.find((a) => !a.startsWith("-") && !a.includes("="));
        if (!recipe) continue;
        if (!project.hasJustfile) {
          add({ rule: "stale-command", message: `\`${subject}\` needs a justfile, and this repository has none.` });
        } else if (!project.justRecipes.has(recipe)) {
          add({
            rule: "stale-command",
            message: `\`${subject}\` names the recipe \`${recipe}\`, which the justfile does not define.`,
          });
        }
      }
    }
  }
  return findings;
}
