import assert from "node:assert/strict";
import { test } from "node:test";
import { secrets } from "../src/checks/secrets.js";
import { contextOf, randomText } from "./helpers.js";

// No test writes a token as a literal. Each is built when the test runs, so that the repository itself holds nothing
// that a secret scanner would stop a push for.
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const found = (t: Parameters<typeof contextOf>[0], text: string, name?: string) =>
  secrets(contextOf(t, text, name)).filter((f) => f.rule === "secret");
const paths = (t: Parameters<typeof contextOf>[0], text: string) =>
  secrets(contextOf(t, text)).filter((f) => f.rule === "personal-path");

test("every known kind of key is an error with high confidence, and the report never contains the key", (t) => {
  const keys: [string, string][] = [
    ["an AWS access key ID", `AKIA${randomText(16, UPPER, 1)}`],
    ["a GitHub token", `ghp_${randomText(36, ALNUM, 2)}`],
    ["a GitHub token", `github_pat_${randomText(60, ALNUM, 3)}`],
    ["an Anthropic API key", `sk-ant-${randomText(48, ALNUM, 4)}`],
    ["an OpenAI API key", `sk-proj-${randomText(60, ALNUM, 5)}`],
    ["a Slack token", `xoxb-${randomText(30, ALNUM, 6)}`],
    ["a Stripe live key", `sk_live_${randomText(30, ALNUM, 7)}`],
    ["a Google API key", `AIza${randomText(35, ALNUM, 8)}`],
    ["an npm token", `npm_${randomText(36, ALNUM, 9)}`],
    ["a Hugging Face token", `hf_${randomText(36, ALNUM, 10)}`],
  ];
  for (const [what, key] of keys) {
    const fs = found(t, `# Setup\n\nExport it first: ${key}\n`);
    assert.equal(fs.length, 1, `${what}: ${fs.length} findings`);
    const [f] = fs;
    assert.equal(f?.severity, "error");
    assert.equal(f?.confidence, "high");
    assert.equal(f?.line, 3);
    assert.match(f?.message ?? "", new RegExp(what));
    assert.ok(!JSON.stringify(f).includes(key), `the finding for ${what} shows the key`);
    assert.ok(!JSON.stringify(f).includes(key.slice(0, 12 + 8)), `the finding for ${what} shows too much of the key`);
  }
});

test("a key is found in a code block, in the header and in an HTML comment, and not only in running text", (t) => {
  const key = `ghp_${randomText(36, ALNUM, 11)}`;
  assert.equal(found(t, `---\nname: x\ntoken: ${key}\n---\ntext\n`).length, 1);
  assert.equal(found(t, "```sh\nexport GH=" + key + "\n```\n").length, 1);
  assert.equal(found(t, `<!-- ${key} -->\n`).length, 1);
});

test("placeholders, examples and the alphabet are not keys", (t) => {
  const text = [
    `AKIAIOSFODNN7EXAMPLE`,
    `ghp_${"x".repeat(36)}`,
    `sk-${"1234567890abcdefghijklmnopqrstuvwxyz"}1234`,
    `sk-your-api-key-goes-here-and-it-is-long-enough`,
    `sk-ant-${"a".repeat(40)}`,
    `AIza${"0".repeat(35)}`,
    `npm_${"A".repeat(36)}`,
  ].join("\n");
  assert.deepEqual(found(t, text), []);
});

test("a private key is reported when its body follows, and not when only the header is written", (t) => {
  const header = "-----BEGIN " + "RSA PRIVATE KEY-----";
  assert.deepEqual(found(t, `Paste the ${header} block here.\n`), []);
  const body = randomText(64, ALNUM + "+/", 12);
  const fs = found(t, `${header}\n${body}\n-----END RSA PRIVATE KEY-----\n`);
  assert.equal(fs.length, 1);
  assert.match(fs[0]?.message ?? "", /a private key/);
  assert.ok(!JSON.stringify(fs[0]).includes(body.slice(0, 20)));
});

test("a value assigned to a name like api_key or password is a warning when it looks random", (t) => {
  const value = randomText(32, ALNUM, 13);
  const fs = found(t, `API_KEY=${value}\n`);
  assert.equal(fs.length, 1);
  assert.equal(fs[0]?.severity, "warning");
  assert.equal(fs[0]?.confidence, "medium");
  assert.ok(!JSON.stringify(fs[0]).includes(value));
  assert.equal(found(t, `password: "${randomText(17, ALNUM, 14)}"\n`)[0]?.confidence, "low");
  assert.equal(found(t, `DB_PASSWORD = ${value}\n`).length, 1, "a name with a prefix counts");
});

test("a name, a reference to a variable, a placeholder and an identifier are not secrets", (t) => {
  const text = [
    "token: ${{ secrets.GITHUB_TOKEN }}",
    "password = process.env.DATABASE_PASSWORD_VALUE",
    "API_KEY=your-api-key-here-123456",
    "api_key: my-service-name-123456",
    "token=4d6e7543-ae20-4355-951c-c6421b8f1b5f",
    "SECRET_KEY=SOME_ENVIRONMENT_VARIABLE_NAME",
    "password=<your password>",
    "token=short",
    "tokens = " + randomText(32, ALNUM, 15),
  ].join("\n");
  assert.deepEqual(found(t, text), []);
});

test("a password in a URL is reported when it is random, and not the usual example", (t) => {
  const password = randomText(20, ALNUM, 16);
  const fs = found(t, `DATABASE_URL: postgres://app:${password}@db.internal:5432/main\n`);
  assert.equal(fs.length, 1);
  assert.match(fs[0]?.message ?? "", /a password in a URL/);
  assert.equal(fs[0]?.column, 30);
  assert.ok(!JSON.stringify(fs[0]).includes(password));
  assert.deepEqual(
    found(
      t,
      "postgres://user:password@localhost/db\nredis://admin:${REDIS_PASSWORD}@cache\nhttps://me:<token>@host/x\n",
    ),
    [],
  );
});

test("a JSON Web Token is a warning, and the token from jwt.io is left alone", (t) => {
  const token = `eyJ${randomText(30, ALNUM, 17)}.eyJ${randomText(40, ALNUM, 18)}.${randomText(43, ALNUM, 19)}`;
  const fs = found(t, `Authorization: Bearer ${token}\n`);
  assert.equal(fs.length, 1);
  assert.equal(fs[0]?.severity, "warning");
  const jwtIo =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  assert.deepEqual(found(t, `${jwtIo}\n`), []);
});

test("the name of a key next to the key is one finding", (t) => {
  assert.equal(found(t, `OPENAI_API_KEY=sk-${randomText(48, ALNUM, 20)}\n`).length, 1);
});

test("a path on one person's computer is a warning, with the user name in it", (t) => {
  const fs = paths(t, "Open `/Users/jamespark/Documents/Projects/App/src/main.ts` first.\n");
  assert.equal(fs.length, 1);
  assert.equal(fs[0]?.severity, "warning");
  assert.equal(fs[0]?.confidence, "medium");
  assert.equal(fs[0]?.subject, "/Users/jamespark/Documents/Projects/App/src/main.ts");
  assert.equal(fs[0]?.column, 7);
  assert.equal(paths(t, "cd C:\\Users\\james\\Desktop\\app\n")[0]?.confidence, "medium");
});

test("a /home path is less certain, since /home is also a page in a web application", (t) => {
  assert.equal(paths(t, "Clone it into /home/james/work/app.\n")[0]?.confidence, "low");
});

test("paths that belong to no one, and names that stand for the reader, are left alone", (t) => {
  const text = [
    "/Users/you/project/src",
    "/Users/<name>/project",
    "/Users/username/project/x",
    "/home/runner/work/app/app/x",
    "/home/node/app/x",
    "C:\\Users\\Public\\x",
    "src/home/james/page.ts",
    "https://example.com/home/james/page",
    "~/projects/app/x",
  ].join("\n");
  assert.deepEqual(paths(t, text), []);
});
