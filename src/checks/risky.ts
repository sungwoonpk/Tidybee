import type { Context, Doc } from "../analyze.js";
import { shorten, windowsOf } from "../text.js";
import type { Finding } from "../types.js";
import { commandsIn } from "./commands.js";
import { warnedAgainst } from "./context.js";

// Advice that has an agent run something it should not, or switch off what protects it. Only commands in code spans, in
// shell blocks and in HTML comments are read, the places where an agent finds a command to run. A file that says
// "never run `curl | sh`" warns against the command, and the checks leave it alone: see warnedAgainst.

const SHELL_LANGS = new Set([
  "",
  "sh",
  "bash",
  "shell",
  "zsh",
  "fish",
  "console",
  "text",
  "txt",
  "plain",
  "powershell",
  "pwsh",
  "ps1",
  "cmd",
  "bat",
]);

interface Risk {
  id: string;
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  /** What it does, in a clause that follows "a command that". */
  does: string;
  suggestion?: string;
  /** The matched text, or null when the line is fine. `anywhere` is true for a comment, where a command is not at the start of the text. */
  find(text: string, anywhere: boolean): string | null;
}

function first(res: RegExp[]): (text: string) => string | null {
  return (text) => {
    for (const re of res) {
      const m = re.exec(text);
      if (m) return m[0];
    }
    return null;
  };
}

const DOWNLOADERS = "(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)";
const SHELLS = "(?:(?:ba|z|da|k|c|fi)?sh|iex|invoke-expression)";
const ANY_INTERPRETER = "(?:(?:ba|z|da|k|c|fi)?sh|python3?|perl|ruby|node|php|iex|invoke-expression)";
const SUDO = "(?:sudo\\s{1,5}(?:-\\S{1,20}\\s{1,5}){0,3})?";

const PROGRAMS = new Set(["rm", "chmod", "git"]);

/**
 * The commands of a comment, which is prose with a command somewhere in it: from each program that is one of ours to the
 * next separator. A command line starts with its program, a comment does not.
 */
function commandsAnywhere(text: string): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[][] = [];
  for (let i = 0; i < words.length; i++) {
    if (!PROGRAMS.has(words[i] as string)) continue;
    const command = [words[i] as string];
    for (let j = i + 1; j < words.length && command.length < 30; j++) {
      const word = words[j] as string;
      const stop = /[;|&]+$/.test(word);
      const bare = word.replace(/[;|&]+$/, "");
      if (bare !== "") command.push(bare);
      if (stop) break;
    }
    out.push(command);
  }
  return out;
}

function tokensOf(text: string, anywhere: boolean): string[][] {
  return (anywhere ? commandsAnywhere(text) : commandsIn(text)).map((t) => t.map((w) => w.replace(/^["']|["']$/g, "")));
}

const CATASTROPHIC_TARGETS = new Set([
  "/",
  "/*",
  "~",
  "~/",
  "~/*",
  "$HOME",
  "$HOME/",
  "$HOME/*",
  "${HOME}",
  "${HOME}/",
  "${HOME}/*",
]);

const RISKS: Risk[] = [
  {
    id: "pipe-to-shell",
    severity: "warning",
    confidence: "medium",
    does: "runs a script from the network without anyone reading it",
    suggestion: "Download it, read it, and pin a version or a checksum.",
    find: first([
      new RegExp(`\\b${DOWNLOADERS}\\b[^|\\n]{0,300}\\|\\s{0,5}${SUDO}${SHELLS}\\b`, "i"),
      // An interpreter runs what it is given only when it is given nothing else to run: "| python3" and "| node -", and
      // not "| python3 -m json.tool" or "| node -e 'code'".
      new RegExp(
        `\\b${DOWNLOADERS}\\b[^|\\n]{0,300}\\|\\s{0,5}${SUDO}(?:python3?|perl|ruby|node|php)(?:\\s{1,5}-)?\\s{0,5}(?=$|[;&|)"'\`])`,
        "i",
      ),
      new RegExp(
        `\\b(?:(?:ba|z|da)?sh|eval)\\s{1,5}(?:-c\\s{1,5})?["']?\\$\\(\\s{0,3}(?:curl|wget)\\b[^)\\n]{0,300}\\)`,
        "i",
      ),
      new RegExp(`\\b(?:source|\\.|(?:ba|z)?sh)\\s{1,5}<\\(\\s{0,3}(?:curl|wget)\\b[^)\\n]{0,300}\\)`, "i"),
      /\biex\s{0,3}\(?\s{0,3}\(?\s{0,3}(?:iwr|irm|invoke-webrequest|invoke-restmethod|new-object\s{1,5}net\.webclient)\b[^\n]{0,200}/i,
    ]),
  },
  {
    id: "encoded-payload",
    severity: "error",
    confidence: "high",
    does: "decodes a hidden payload and runs it",
    suggestion: "Nothing legitimate is written this way. Find out who added it.",
    find: first([
      new RegExp(
        `\\bbase64\\s{1,5}(?:-d|--decode|-D)\\b[^|\\n]{0,60}\\|\\s{0,5}(?:sudo\\s{1,5})?${ANY_INTERPRETER}\\b`,
        "i",
      ),
    ]),
  },
  {
    id: "skip-permissions",
    severity: "warning",
    confidence: "medium",
    does: "turns off the agent's own permission prompts, so what it runs is no longer approved by anyone",
    suggestion: "Allow the specific commands that are needed in the agent's settings instead.",
    find: first([
      /--dangerously-skip-permissions\b/,
      /--dangerously-bypass-approvals-and-sandbox\b/,
      /--(?:yolo|trust-all-tools)\b/,
      /--permission-mode[ =]bypassPermissions\b/,
      /--approval-mode[ =]yolo\b/,
      /--sandbox[ =]danger-full-access\b/,
    ]),
  },
  {
    id: "tls-off",
    severity: "warning",
    confidence: "medium",
    does: "stops checking who is on the other end of an encrypted connection",
    suggestion: "Fix the certificate. A tool that does not check it can be sent anything.",
    find: first([
      /\bcurl\b[^|\n]{0,200}\s(?:--insecure|-[A-Za-z]{0,10}k[A-Za-z]{0,10})(?=\s|$)/,
      /\bwget\b[^|\n]{0,200}\s--no-check-certificate\b/,
      /\bNODE_TLS_REJECT_UNAUTHORIZED=0\b/,
      /\bGIT_SSL_NO_VERIFY=(?:1|true)\b/,
      /\bhttp\.sslVerify\s{1,5}false\b/,
      /\bstrict-ssl\s{1,5}false\b/,
    ]),
  },
  {
    id: "rm-root",
    severity: "warning",
    confidence: "medium",
    does: "deletes a whole computer's files or a whole home folder",
    find(text, anywhere) {
      for (const [program, ...args] of tokensOf(text, anywhere)) {
        if (program !== "rm") continue;
        const recursive = args.some((a) => a === "--recursive" || /^-[A-Za-z]*[rR]/.test(a));
        if (recursive && args.some((a) => CATASTROPHIC_TARGETS.has(a))) return [program, ...args].join(" ");
      }
      return null;
    },
  },
  {
    id: "chmod-777",
    severity: "info",
    confidence: "low",
    does: "lets every user on the computer change a file",
    find(text, anywhere) {
      for (const [program, ...args] of tokensOf(text, anywhere)) {
        if (program === "chmod" && args.some((a) => a === "777" || a === "0777" || a === "a+rwx"))
          return [program, ...args].join(" ");
      }
      return null;
    },
  },
  {
    id: "force-push",
    severity: "info",
    confidence: "low",
    does: "overwrites commits that other people may have built on",
    suggestion: "`git push --force-with-lease` refuses when someone else has pushed.",
    find(text, anywhere) {
      for (const [program, ...args] of tokensOf(text, anywhere)) {
        if (program === "git" && args.includes("push") && args.some((a) => a === "--force" || a === "-f"))
          return [program, ...args].join(" ");
      }
      return null;
    },
  },
  {
    id: "skip-hooks",
    severity: "info",
    confidence: "low",
    does: "skips the checks that the repository runs before a commit or a push",
    find(text, anywhere) {
      for (const [program, ...args] of tokensOf(text, anywhere)) {
        if (program === "git" && args.includes("--no-verify")) return [program, ...args].join(" ");
      }
      return null;
    },
  },
];

interface Source {
  text: string;
  line: number;
  column: number;
  /** Where it was found. A comment is hidden on GitHub, so a command in one is more worrying. */
  where: "span" | "fence" | "comment";
  fenceStart?: number;
}

function sourcesOf(doc: Doc): Source[] {
  const out: Source[] = [];
  for (const s of doc.md.codeSpans) out.push({ text: s.text, line: s.line, column: s.column, where: "span" });
  for (const f of doc.md.fences) {
    if (!SHELL_LANGS.has(f.lang)) continue;
    for (const l of f.lines) {
      if (!l.text.trimStart().startsWith("#"))
        out.push({ text: l.text, line: l.line, column: 1, where: "fence", fenceStart: f.startLine });
    }
  }
  for (const c of doc.md.comments) out.push({ text: c.text, line: c.line, column: 1, where: "comment" });
  return out;
}

export function riskyCommands(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const doc of ctx.docs) {
    const seen = new Set<string>();
    for (const src of sourcesOf(doc)) {
      const hidden = src.where === "comment";
      // A long line is read window by window, so that padding in front of a command does not hide it.
      const windows = windowsOf(src.text);
      for (const risk of RISKS) {
        const key = `${src.line}:${risk.id}`;
        if (seen.has(key)) continue;
        let hit: string | null = null;
        for (const w of windows) {
          hit = risk.find(w, hidden);
          if (hit !== null) break;
        }
        if (hit === null) continue;
        // A comment is where an attack hides, so a warning near a command in one is not taken for the file's own.
        if (!hidden && warnedAgainst(doc, src.line, src.fenceStart, hit)) continue;
        seen.add(key);
        out.push({
          file: doc.file.path,
          line: src.line,
          column: src.column,
          rule: "risky-command",
          severity: hidden && risk.severity === "warning" ? "error" : risk.severity,
          confidence: hidden && risk.confidence === "medium" ? "high" : risk.confidence,
          subject: shorten(hit, 80),
          message: `\`${shorten(hit, 80)}\` ${risk.does}.${hidden ? " It is in an HTML comment, which is not shown on GitHub and which an agent reads." : " An agent that follows this file will do the same."}`,
          ...(risk.suggestion ? { suggestion: risk.suggestion } : {}),
        });
      }
    }
  }
  return out;
}
