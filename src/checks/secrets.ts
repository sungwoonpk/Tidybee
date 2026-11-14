import type { Context, Doc } from "../analyze.js";
import { entropy } from "../text.js";
import type { Finding } from "../types.js";

// Secrets and personal paths in files that are committed, read by every agent, and often pasted into a chat. A finding
// never prints the secret: the report goes into logs and code scanning, and a secret that is shown there has leaked again.

/** A line is read to this length. Real secrets are short, and a longer line is data, not an instruction. */
const MAX_LINE = 20_000;

interface KnownFormat {
  name: string;
  re: RegExp;
}

// Keys that have a fixed prefix and shape. Every repeated part has an upper size.
const KNOWN: KnownFormat[] = [
  { name: "an AWS access key ID", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z2-7]{16}\b/g },
  { name: "a GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g },
  { name: "an Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{32,200}/g },
  { name: "an OpenAI API key", re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,200}/g },
  { name: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,200}/g },
  { name: "a Stripe live key", re: /\b[rs]k_live_[A-Za-z0-9]{20,200}/g },
  { name: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "an npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "a Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,200}/g },
  { name: "a SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  {
    name: "a Slack webhook",
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,30}\/B[A-Z0-9]{8,30}\/[A-Za-z0-9]{20,60}/g,
  },
  { name: "a Discord webhook", re: /discord(?:app)?\.com\/api\/webhooks\/\d{15,25}\/[A-Za-z0-9_-]{50,100}/g },
];

const JWT = /\beyJ[A-Za-z0-9_-]{10,500}\.eyJ[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500}/g;
// The token on jwt.io, and the many copies of it in documentation.
const JWT_EXAMPLE = "eyJzdWIiOiIxMjM0NTY3ODkwIi";

const PRIVATE_KEY = /-----BEGIN (?:[A-Z]{2,10} ){0,3}PRIVATE KEY(?: BLOCK)?-----/;

// "api_key = ..." and the like. The name is matched after anything that is not a letter or digit, so DB_PASSWORD counts.
const ASSIGNMENT =
  /(?<![A-Za-z0-9])(?:api[_-]?key|apikey|secret(?:[_-]?key)?|access[_-]?key|auth[_-]?token|access[_-]?token|token|password|passwd|client[_-]?secret|private[_-]?key)["']?\s{0,3}[:=]\s{0,3}["']?([A-Za-z0-9/+_=.~-]{16,200})/gi;

// "scheme://user:password@host"
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s:@/<>"'`]{1,64}):([^\s@/<>"'`]{4,100})@[^\s/<>"'`]{1,100}/gi;

const PLACEHOLDER =
  /example|sample|dummy|placeholder|redacted|changeme|change-me|your|xxxx|fake|insert|replace|todo|secret_here|key_here|token_here|\*{4}|\.{4}|…/i;
const COMMON_PASSWORDS = new Set(
  "password passwd pass secret changeme example user admin root postgres mypassword yourpassword test 1234 12345 123456 qwerty hunter2 letmein".split(
    " ",
  ),
);

function isSequential(text: string): boolean {
  let run = 1;
  for (let i = 1; i < text.length; i++) {
    const step = text.charCodeAt(i) - text.charCodeAt(i - 1);
    run = step === 1 || step === -1 ? run + 1 : 1;
    if (run >= 8) return true;
  }
  return false;
}

function hasRepeat(text: string): boolean {
  let run = 1;
  for (let i = 1; i < text.length; i++) {
    run = text[i] === text[i - 1] ? run + 1 : 1;
    if (run >= 8) return true;
  }
  return false;
}

/** True when text could be a real random secret, and not a placeholder, a run of one character or the alphabet. */
function looksRandom(text: string, minEntropy: number): boolean {
  return !PLACEHOLDER.test(text) && !hasRepeat(text) && !isSequential(text) && entropy(text) >= minEntropy;
}

/** A value that is made of a word or a few, joined with dashes or dots: a name, not a secret. */
function looksLikeName(value: string): boolean {
  return (
    /^[a-z]+(?:[-_.][a-z0-9]+)+$/.test(value) ||
    /^[A-Z][A-Z_]+$/.test(value) ||
    /^[A-Za-z]+(?:\.[A-Za-z_]+)+$/.test(value)
  );
}

/** An identifier such as 4d6e7543-ae20-4355-951c-c6421b8f1b5f. It names something and is not a secret, even after "token=". */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shows enough of a secret to find it and not enough to use it. */
function redact(value: string): string {
  return `${value.slice(0, 4)}… (${value.length} characters)`;
}

function secretsIn(doc: Doc): Finding[] {
  const out: Finding[] = [];
  const lines = doc.md.lines;
  for (let li = 0; li < lines.length; li++) {
    const text = (lines[li] as string).slice(0, MAX_LINE);
    if (text.length < 12) continue;
    const base = { file: doc.file.path, line: li + 1 };
    let found = false;
    const add = (
      column: number,
      what: string,
      secret: string,
      severity: Finding["severity"],
      confidence: Finding["confidence"],
    ): void => {
      found = true;
      out.push({
        ...base,
        column: column + 1,
        rule: "secret",
        severity,
        confidence,
        subject: redact(secret),
        message: `Looks like ${what} (${redact(secret)}). A secret in a file that is committed is a secret that has leaked, and every agent that reads the file sees it.`,
        suggestion: "Revoke it where it was issued, then read it from an environment variable or a secret store.",
      });
    };

    for (const { name, re } of KNOWN) {
      for (const m of text.matchAll(re)) {
        if (looksRandom(m[0], 3)) add(m.index ?? 0, name, m[0], "error", "high");
      }
    }
    for (const m of text.matchAll(JWT)) {
      if (!m[0].includes(JWT_EXAMPLE)) add(m.index ?? 0, "a JSON Web Token", m[0], "warning", "medium");
    }
    const key = PRIVATE_KEY.exec(text);
    if (key) {
      // The header alone appears in documentation. A key has its encoded body on the lines after it.
      const body = (lines[li + 1] ?? "").trim();
      if (/^[A-Za-z0-9+/=]{40,}$/.test(body) || /^Proc-Type:/.test(body))
        add(key.index, "a private key", key[0], "error", "high");
    }
    for (const m of text.matchAll(URL_CREDENTIALS)) {
      const password = m[2] as string;
      if (COMMON_PASSWORDS.has(password.toLowerCase()) || /[$*{]/.test(password)) continue;
      if (/\d/.test(password) && /[A-Za-z]/.test(password) && looksRandom(password, 2.8))
        add(
          (m.index ?? 0) + m[0].indexOf(":", m[0].indexOf("//")) + 1,
          "a password in a URL",
          password,
          "warning",
          "medium",
        );
    }
    if (found) continue; // the name of a key next to the key is the same finding
    for (const m of text.matchAll(ASSIGNMENT)) {
      const value = m[1] as string;
      if (
        UUID.test(value) ||
        looksLikeName(value) ||
        !/\d/.test(value) ||
        !/[A-Za-z]/.test(value) ||
        !looksRandom(value, 3.3)
      )
        continue;
      const strong = value.length >= 20 && entropy(value) >= 3.7;
      add(
        (m.index ?? 0) + m[0].length - value.length,
        "a secret that is assigned to a name",
        value,
        "warning",
        strong ? "medium" : "low",
      );
    }
  }
  return out;
}

// Places that are the same on every machine, or a name that stands for whoever reads it.
const GENERIC_USERS = new Set(
  "user users username yourname your-name you me name foo bar baz john jane alice bob example runner runneradmin ubuntu node vscode app appuser root shared guest public default admin dev developer docker jenkins circleci build vagrant codespace gitpod coder linuxbrew nobody www-data pi ec2-user azureuser git builder agent".split(
    " ",
  ),
);

const UNIX_HOME = /(?<![\w./~-])\/(Users|home)\/([A-Za-z0-9._-]{1,32})(?=\/)/g;
const WINDOWS_HOME = /(?<![\w])[A-Za-z]:\\Users\\([A-Za-z0-9._-]{1,32})(?=\\)/g;

function personalPathsIn(doc: Doc): Finding[] {
  const out: Finding[] = [];
  const lines = doc.md.lines;
  for (let li = 0; li < lines.length; li++) {
    const text = (lines[li] as string).slice(0, MAX_LINE);
    if (!text.includes("Users") && !text.includes("/home/")) continue;
    const add = (index: number, length: number, name: string, confidence: Finding["confidence"]): void => {
      if (GENERIC_USERS.has(name.toLowerCase())) return;
      const path = text.slice(index, index + length + 30).split(/[\s`"'<>)]/)[0] as string;
      out.push({
        file: doc.file.path,
        line: li + 1,
        column: index + 1,
        rule: "personal-path",
        severity: "warning",
        confidence,
        subject: path,
        message: `\`${path}\` is a place on one person's computer. It does not exist on anyone else's, and it gives away a user name.`,
        suggestion: "Write the path from the root of the repository, or from `~`.",
      });
    };
    for (const m of text.matchAll(UNIX_HOME)) {
      // /Users is how macOS names a home. /home is also the name of a page in a web application, so it is less certain.
      add(m.index ?? 0, m[0].length, m[2] as string, m[1] === "Users" ? "medium" : "low");
    }
    for (const m of text.matchAll(WINDOWS_HOME)) add(m.index ?? 0, m[0].length, m[1] as string, "medium");
  }
  return out;
}

export function secrets(ctx: Context): Finding[] {
  return ctx.docs.flatMap((d) => [...secretsIn(d), ...personalPathsIn(d)]);
}
