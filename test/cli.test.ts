import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { makeRepo } from "./helpers.js";

// These run the real command line, as a separate process, which is how people will meet it.
// The loader is named by its full address, since the program runs in a temporary folder that has no node_modules.
const tsx = import.meta.resolve("tsx");
const entry = new URL("../src/cli.ts", import.meta.url).pathname;
const cli = (args: string[], cwd: string) =>
  spawnSync(process.execPath, ["--import", tsx, entry, ...args], { cwd, encoding: "utf8" });

test("the command line prints the report and exits with 1 when it finds an error", (t) => {
  const cwd = makeRepo(t, { "CLAUDE.md": "```\nnpm run nope\n```\n", "package.json": '{"scripts":{}}' });
  const r = cli(["check"], cwd);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error\s+`npm run nope` runs the script `nope`/);
  assert.equal(r.stderr, "");
});

test("the command line exits with 0 on a clean repository and 2 on a mistake", (t) => {
  const clean = makeRepo(t, { "CLAUDE.md": "Nothing wrong here.\n" });
  assert.equal(cli(["check"], clean).status, 0);
  const bad = cli(["check", "--format", "xml"], clean);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--format must be text or json/);
});
