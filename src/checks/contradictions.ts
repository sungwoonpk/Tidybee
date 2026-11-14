import type { Context, Doc } from "../analyze.js";
import type { Manager } from "../project.js";
import type { Finding } from "../types.js";
import { commandsIn } from "./commands.js";
import { headingAbove, warnedAgainst } from "./context.js";

// Rules that say the opposite of each other: tabs in one place and spaces in another, `npm` here and `pnpm` there, "commit
// as you go" and "never commit unless asked". An agent that reads both has to choose, and it chooses differently each time.
//
// This is not a reading of meaning. It knows a short list of topics, and for each the few ways a rule about it is written.
// It says nothing about a pair unless both sides are plain statements about the same topic in the same scope, and it
// leaves out a statement that has a condition in it ("when", "unless", "except"), since that one may be the exception.

interface Topic {
  id: string;
  /** What the topic is, for the message. */
  name: string;
  /** The side a statement takes, or null when it takes none. The text is lower case, without emphasis. */
  side(text: string): string | null;
  /** What a side asks for, written to follow "says to". */
  asks(side: string): string;
  /** True when two sides cannot both be followed. By default two different sides cannot. */
  conflicts?(a: string, b: string): boolean;
  /** A statement with "unless asked" in it is still a plain statement about this topic. */
  allowsAsking?: boolean;
  /**
   * What keeps two statements apart. By default the language or the part of the project a statement names, and the folder.
   * "places" is for a topic that is about the whole repository, such as the package manager: only a folder keeps those apart.
   */
  scope?: "places";
}

// ---- reading a statement ---------------------------------------------------------------------------------------------

/** Words that turn the next few words around: "not npm", "never use tabs", "instead of jest", "pnpm over npm". */
const TURNS =
  /\b(?:no|not|never|don'?t|do not|dont|avoid|without|stop using|skip|drop|omit|instead of|rather than|over)\s+(?:[\w-]+\s+){0,2}$/;
/** Words that make a statement conditional, and so possibly an exception. */
const CONDITION =
  /\b(?:except|unless|but|however|otherwise|apart from|only when|only if|when|whenever|if|while|although|though)\b/;
/** "Unless I ask" and the like. It is the usual way to say "do not do this by yourself", and not an exception to anything. */
const ASKING =
  /\b(?:unless|until|without|before|except)\b[^.]{0,30}\b(?:ask(?:ed|ing)?|told|tell|request(?:ed)?|instruct(?:ed)?|permission|approval|confirm(?:ation|ed)?|explicit(?:ly)?)\b/g;

function plain(text: string): string {
  return text.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
}

interface Hit {
  index: number;
  turned: boolean;
}

function hit(text: string, re: RegExp): Hit | null {
  const m = re.exec(text);
  if (!m) return null;
  return { index: m.index, turned: TURNS.test(text.slice(Math.max(0, m.index - 40), m.index)) };
}

/** Two phrases that are each other's opposite. "Not A" says B. A statement that names both compares them and says nothing. */
function opposites(text: string, a: [string, RegExp], b: [string, RegExp]): string | null {
  const ha = hit(text, a[1]);
  const hb = hit(text, b[1]);
  if (ha && hb) return null;
  if (ha) return ha.turned ? b[0] : a[0];
  if (hb) return hb.turned ? a[0] : b[0];
  return null;
}

/** One phrase that is switched on or off: "use semicolons" and "no semicolons". */
function toggle(text: string, phrase: RegExp): "on" | "off" | null {
  const h = hit(text, phrase);
  return h ? (h.turned ? "off" : "on") : null;
}

/** Several choices. A statement that names one of them as the choice says that one: "use pnpm instead of npm" says pnpm. */
function choice(text: string, phrases: [string, RegExp][]): string | null {
  const chosen = phrases.filter(([, re]) => {
    const h = hit(text, re);
    return h !== null && !h.turned;
  });
  return chosen.length === 1 ? (chosen[0] as [string, RegExp])[0] : null;
}

// ---- the topics ------------------------------------------------------------------------------------------------------

const MANAGERS: [Manager, RegExp][] = [
  ["npm", /\bnpm\b/],
  ["pnpm", /\bpnpm\b/],
  ["yarn", /\byarn\b/],
  ["bun", /\bbun\b/],
];
// A statement chooses a package manager when it says to use one. "Run `npm publish`" names npm and chooses nothing.
const USE_MANAGERS: [Manager, RegExp][] = [
  ["npm", /\b(?:use|using|prefer|with|via)\s+(?:[\w-]+\s+)?npm\b/],
  ["pnpm", /\b(?:use|using|prefer|with|via)\s+(?:[\w-]+\s+)?pnpm\b/],
  ["yarn", /\b(?:use|using|prefer|with|via)\s+(?:[\w-]+\s+)?yarn\b/],
  ["bun", /\b(?:use|using|prefer|with|via)\s+(?:[\w-]+\s+)?bun\b/],
];
const ABOUT_PACKAGES = /\b(?:install(?:ing|s)?|dependencies|packages?|package manager|scripts?)\b/;
const COMMIT_AUTO =
  /\b(?:commit(?:ting)?|make commits?)\b[^.]{0,40}\b(?:automatically|after (?:each|every|any)|frequently|often|regularly|as you go|without (?:being )?(?:asked|asking))\b|\balways commit\b|\bcommit (?:early and often|after every)\b/;
const COMMIT_ASK = [
  /\b(?:ask|confirm|check)\b[^.]{0,30}\bbefore (?:you )?(?:commit|committing|making (?:a )?commits?)\b/,
  /\b(?:never|don'?t|do not|must not)\s+(?:commit|make (?:a )?commits?)\b[^.]{0,40}\b(?:unless|until|without|except|before)\b[^.]{0,30}\b(?:ask|told|request|permission|approval|explicit|instruct|confirm)/,
  /\bonly commit (?:when|if|after)\b[^.]{0,30}\b(?:ask|told|request|i |user|explicit)/,
  /\b(?:never|don'?t|do not) (?:commit|make commits?) (?:on your own|by yourself|automatically|proactively|anything)\b/,
];
const PUSH_AUTO =
  /\bpush(?:ing)?\b[^.]{0,40}\b(?:automatically|after (?:each|every|any)|frequently|often|regularly|as you go|without (?:being )?(?:asked|asking))\b|\balways push\b/;
const PUSH_ASK = [
  /\b(?:ask|confirm|check)\b[^.]{0,30}\bbefore (?:you )?(?:push|pushing)\b/,
  /\b(?:never|don'?t|do not|must not)\s+push\b[^.]{0,40}\b(?:unless|until|without|except|before)\b[^.]{0,30}\b(?:ask|told|request|permission|approval|explicit|instruct|confirm)/,
  /\bonly push (?:when|if|after)\b[^.]{0,30}\b(?:ask|told|request|i |user|explicit)/,
  /\b(?:never|don'?t|do not) push (?:on your own|by yourself|automatically|proactively|anything)\b/,
];
const ANY = (res: RegExp[]) => (text: string) => res.some((re) => re.test(text));

const LINE_LENGTH =
  /\b(?:max(?:imum)?|limit|at most|no more than|no longer than|under|below|within|up to|wrap(?:ped)? (?:at|to)|exceed(?:ing)?)\b[^.]{0,40}?\b(\d{2,3})\s*(?:characters?|chars?|columns?|cols?)\b|\b(\d{2,3})[- ](?:characters?|chars?|columns?|cols?)(?: line| limit| width| max| wide)|\b(?:line length|line width|print width|column limit)\b[^.]{0,30}?\b(\d{2,3})\b/;
const NOT_LINES = /\b(?:commit|message|title|summary|subject|description|name|filename|url|string|header)\b/;

const TOPICS: Topic[] = [
  {
    id: "indentation",
    name: "indentation",
    side(text) {
      const spaces = /\b(\d{1,2})[- ]spaces?\b/.exec(text);
      const tabs = hit(text, /\btabs?\b/);
      const about = /\bindent/.test(text) || /\b(?:use|using|with|prefer) (?:\d{1,2} )?(?:tabs?|spaces)\b/.test(text);
      if (!about || (tabs && spaces)) return null;
      if (spaces) return `${spaces[1]} spaces`;
      if (tabs) return tabs.turned ? "spaces" : "tabs";
      return /\bspaces\b/.test(text) ? "spaces" : null;
    },
    asks: (s) => `indent with ${s}`,
    // "spaces" without a number does not disagree with a number of spaces.
    conflicts: (a, b) =>
      a !== b && !(a === "spaces" && b.endsWith(" spaces")) && !(b === "spaces" && a.endsWith(" spaces")),
  },
  {
    id: "line-length",
    name: "line length",
    side(text) {
      if (NOT_LINES.test(text) || !/\b(?:lines?|width|columns?)\b/.test(text)) return null;
      const m = LINE_LENGTH.exec(text);
      const n = Number(m?.[1] ?? m?.[2] ?? m?.[3]);
      return n >= 60 && n <= 200 ? String(n) : null;
    },
    asks: (s) => `keep lines to ${s} characters`,
  },
  {
    id: "semicolons",
    name: "semicolons",
    side: (text) => toggle(text, /\bsemicolons?\b/),
    asks: (s) => (s === "on" ? "end statements with semicolons" : "leave out semicolons"),
  },
  {
    id: "quotes",
    name: "quotation marks",
    side: (text) => opposites(text, ["single", /\bsingle[- ]quotes?\b/], ["double", /\bdouble[- ]quotes?\b/]),
    asks: (s) => `use ${s} quotes`,
  },
  {
    id: "trailing-commas",
    name: "trailing commas",
    side: (text) => toggle(text, /\btrailing commas?\b/),
    asks: (s) => (s === "on" ? "use trailing commas" : "leave out trailing commas"),
  },
  {
    id: "module-system",
    name: "the module system",
    side: (text) =>
      opposites(
        text,
        ["ES modules", /\b(?:es ?modules?|esm|es6 modules?|import\/export|import (?:syntax|statements?))\b/],
        ["CommonJS", /\b(?:commonjs|cjs|require\(\)|require (?:syntax|calls?|statements?))\b/],
      ),
    asks: (s) => `use ${s}`,
  },
  {
    id: "javascript-test-runner",
    scope: "places",
    name: "the test runner",
    side: (text) =>
      choice(text, [
        ["Jest", /\bjest\b/],
        ["Vitest", /\bvitest\b/],
        ["Mocha", /\bmocha\b/],
        ["Ava", /\bava\b/],
        ["Jasmine", /\bjasmine\b/],
      ]),
    asks: (s) => `test with ${s}`,
  },
  {
    id: "python-test-runner",
    scope: "places",
    name: "the test runner",
    side: (text) =>
      choice(text, [
        ["pytest", /\bpytest\b/],
        ["unittest", /\bunittest\b/],
        ["nose", /\bnose2?\b/],
      ]),
    asks: (s) => `test with ${s}`,
  },
  {
    id: "formatter",
    scope: "places",
    name: "the formatter",
    side: (text) =>
      /\bformat/.test(text)
        ? choice(text, [
            ["Prettier", /\bprettier\b/],
            ["Biome", /\bbiome\b/],
            ["dprint", /\bdprint\b/],
          ])
        : null,
    asks: (s) => `format with ${s}`,
  },
  {
    id: "commit",
    scope: "places",
    name: "committing",
    allowsAsking: true,
    side: (text) => (ANY(COMMIT_ASK)(text) ? "ask" : COMMIT_AUTO.test(text) ? "auto" : null),
    asks: (s) => (s === "auto" ? "commit without being asked" : "commit only when asked"),
  },
  {
    id: "push",
    scope: "places",
    name: "pushing",
    allowsAsking: true,
    side: (text) => (ANY(PUSH_ASK)(text) ? "ask" : PUSH_AUTO.test(text) ? "auto" : null),
    asks: (s) => (s === "auto" ? "push without being asked" : "push only when asked"),
  },
];

const PACKAGE_MANAGER: Topic = {
  id: "package-manager",
  scope: "places",
  name: "the package manager",
  side: () => null, // read from commands and from statements, below
  asks: (s) => `use ${s}`,
};

// ---- scope -----------------------------------------------------------------------------------------------------------

// What a statement is about, when it is about one part of the project. Two statements that disagree about different parts
// do not disagree: "Go uses tabs" and "Python uses 4 spaces".
const SCOPES: [string, RegExp][] = [
  ["typescript", /\b(?:typescript|ts|tsx)\b/],
  ["javascript", /\b(?:javascript|js|jsx)\b/],
  ["python", /\b(?:python|py)\b/],
  ["go", /\b(?:go|golang)\b/],
  ["rust", /\brust\b/],
  ["java", /\bjava\b/],
  ["kotlin", /\bkotlin\b/],
  ["swift", /\bswift\b/],
  ["ruby", /\bruby\b/],
  ["php", /\bphp\b/],
  ["c#", /\bc#/],
  ["c++", /\bc\+\+/],
  ["shell", /\b(?:shell|bash|zsh)\b/],
  ["sql", /\bsql\b/],
  ["css", /\b(?:css|scss|sass)\b/],
  ["html", /\bhtml\b/],
  ["yaml", /\b(?:yaml|yml)\b/],
  ["json", /\bjson\b/],
  ["markdown", /\b(?:markdown|md)\b/],
  ["make", /\bmakefiles?\b/],
  ["docker", /\bdocker(?:file)?\b/],
  ["tests", /\b(?:tests?|specs?|testing)\b/],
  ["frontend", /\b(?:front-?end|ui|client|browser)\b/],
  ["backend", /\b(?:back-?end|server|api|services?)\b/],
  ["docs", /\b(?:docs|documentation|readme)\b/],
  ["scripts", /\bscripts?\b/],
  ["ci", /\b(?:ci|workflows?|pipelines?)\b/],
  ["migrations", /\bmigrations?\b/],
  ["legacy", /\blegacy\b/],
  ["new code", /\bnew code\b/],
  ["generated", /\bgenerated\b/],
  ["mobile", /\b(?:mobile|ios|android)\b/],
  ["infrastructure", /\b(?:infra|infrastructure|terraform)\b/],
  ["cli", /\bcli\b/],
  ["library", /\b(?:libs?|librar(?:y|ies))\b/],
  ["config", /\bconfig(?:uration)?\b/],
];
const PATH_SCOPE = /\b(?:packages|apps|services|libs?|src|examples?)\/[\w.-]{1,40}/g;
const CD = /\bcd\s+([\w./-]{1,100})/;

interface Scope {
  words: string[];
  places: string[];
}

function scopeOf(texts: string[], commands: string[] = []): Scope {
  const words = new Set<string>();
  const places = new Set<string>();
  for (const text of texts) {
    for (const [name, re] of SCOPES) if (re.test(text)) words.add(name);
    for (const m of text.matchAll(PATH_SCOPE)) places.add(m[0]);
  }
  // A command says where it runs with "cd", and says nothing else about scope: "npm run test" is not about tests.
  for (const text of [...texts, ...commands]) {
    const cd = CD.exec(text);
    if (cd) places.add(`cd ${cd[1]}`);
  }
  return { words: [...words], places: [...places] };
}

function scopeKey(topic: Topic, scope: Scope): string {
  return (topic.scope === "places" ? scope.places : [...scope.words, ...scope.places]).sort().join(",");
}

// ---- claims ----------------------------------------------------------------------------------------------------------

interface Claim {
  topic: Topic;
  side: string;
  doc: Doc;
  line: number;
  scope: Scope;
}

const READ_TOGETHER = new Set(["claude", "agents", "gemini", "conventions"]);

/** True when an agent reads both files for the same work, so that a conflict between them is the agent's to resolve. */
function together(a: Doc, b: Doc): boolean {
  if (a.file.path === b.file.path) return true;
  if (a.load === "always" && b.load === "always") return true;
  return a.file.dir === b.file.dir && READ_TOGETHER.has(a.file.kind) && READ_TOGETHER.has(b.file.kind);
}

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "text", "txt", "plain"]);
const USED_FOR = new Set(["install", "i", "ci", "add", "run", "test", "start", "build", "dev"]);
const SCOPING =
  /^(--filter|-F|-r|--recursive|--workspace|-w|--workspaces|--prefix|-C|--dir|--cwd|--workspace-root)(=|$)/;

function statementClaims(doc: Doc, out: Claim[]): void {
  for (const s of doc.md.statements) {
    const text = plain(s.text);
    const heading = plain(headingAbove(doc, s.line) ?? "");
    const stripped = text.replace(ASKING, " ");
    if (CONDITION.test(stripped)) continue;
    const scope = scopeOf([text, heading]);
    for (const topic of TOPICS) {
      const side = topic.side(topic.allowsAsking ? text : stripped);
      if (side !== null) out.push({ topic, side, doc, line: s.line, scope });
    }
  }
}

/** The package manager each statement and each command asks for, where no lockfile has already settled it. */
function managerClaims(doc: Doc, ctx: Context, out: Claim[]): void {
  if (ctx.project.managerFor(doc.file.dir) !== undefined) return; // package-manager reports a mismatch with the lockfile
  const push = (side: string, line: number, scope: Scope): void => {
    out.push({ topic: PACKAGE_MANAGER, side, doc, line, scope });
  };
  for (const s of doc.md.statements) {
    const text = plain(s.text);
    if (!ABOUT_PACKAGES.test(text) || CONDITION.test(text)) continue;
    const side = choice(text, USE_MANAGERS);
    if (side) push(side, s.line, scopeOf([text, plain(headingAbove(doc, s.line) ?? "")]));
  }
  const fromCommand = (text: string, line: number, fenceStart?: number): void => {
    if (/<[^>\s]*>/.test(text) || warnedAgainst(doc, line, fenceStart)) return;
    const heading = plain(headingAbove(doc, line) ?? "");
    for (const [program = "", ...args] of commandsIn(text)) {
      const manager = MANAGERS.find(([name]) => name === program)?.[0];
      if (!manager || args.includes("-g") || args.includes("--global") || args.some((a) => SCOPING.test(a))) continue;
      const word = args.find((a) => !a.startsWith("-"));
      if (word === undefined || !USED_FOR.has(word)) continue;
      push(manager, line, scopeOf([heading], [plain(text)]));
    }
  };
  for (const span of doc.md.codeSpans) fromCommand(span.text, span.line);
  for (const f of doc.md.fences) {
    if (!SHELL_LANGS.has(f.lang)) continue;
    for (const l of f.lines) if (!l.text.trimStart().startsWith("#")) fromCommand(l.text, l.line, f.startLine);
  }
}

function where(a: Claim, from: Claim): string {
  return a.doc.file.path === from.doc.file.path ? `line ${a.line}` : `line ${a.line} of \`${a.doc.file.path}\``;
}

export function contradictions(ctx: Context): Finding[] {
  const claims: Claim[] = [];
  for (const doc of ctx.docs) {
    statementClaims(doc, claims);
    managerClaims(doc, ctx, claims);
  }
  claims.sort((a, b) => a.doc.file.path.localeCompare(b.doc.file.path) || a.line - b.line);

  const out: Finding[] = [];
  const done = new Set<string>();
  for (let j = 1; j < claims.length; j++) {
    const b = claims[j] as Claim;
    const key = `${b.topic.id}|${scopeKey(b.topic, b.scope)}`;
    if (done.has(key)) continue;
    for (let i = 0; i < j; i++) {
      const a = claims[i] as Claim;
      if (a.topic !== b.topic || scopeKey(a.topic, a.scope) !== scopeKey(b.topic, b.scope) || !together(a.doc, b.doc))
        continue;
      const differ = b.topic.conflicts ? b.topic.conflicts(a.side, b.side) : a.side !== b.side;
      if (!differ) continue;
      done.add(key);
      const sure = a.doc.file.path === b.doc.file.path || (a.doc.load === "always" && b.doc.load === "always");
      out.push({
        file: b.doc.file.path,
        line: b.line,
        column: 1,
        rule: "contradiction",
        severity: "warning",
        confidence: sure ? "medium" : "low",
        subject: b.topic.name,
        message: `This says to ${b.topic.asks(b.side)}, and ${where(a, b)} says to ${a.topic.asks(a.side)}. An agent that reads both has to choose, and will not always choose the same.`,
        suggestion: "Decide which is right and delete the other, or say when each applies.",
      });
      break;
    }
  }
  return out;
}
