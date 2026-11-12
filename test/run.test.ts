import assert from "node:assert/strict";
import { test } from "node:test";
import { type IO, run } from "../src/run.js";
import { makeRepo } from "./helpers.js";

function io(cwd: string, extra: Partial<IO> = {}): IO & { stdout: string; stderr: string } {
  const state = { stdout: "", stderr: "" };
  return Object.assign(state, {
    out: (t: string) => void (state.stdout += t),
    err: (t: string) => void (state.stderr += t),
    cwd,
    isTTY: false,
    env: {},
    ...extra,
  }) as IO & { stdout: string; stderr: string };
}

const broken = {
  "CLAUDE.md": "See `src/gone.ts`.\n```\nnpm run nope\n```\n",
  "package.json": '{"scripts":{}}',
  "src/a.ts": "a",
};

test("help and version", (t) => {
  const cwd = makeRepo(t, {});
  const h = io(cwd);
  assert.equal(run(["--help"], h), 0);
  assert.match(h.stdout, /Usage:\n  tidybee check/);
  const v = io(cwd);
  assert.equal(run(["-v"], v), 0);
  assert.match(v.stdout, /^tidybee \d+\.\d+\.\d+\n$/);
});

test("usage mistakes exit with 2 and say why on the error stream", (t) => {
  const cwd = makeRepo(t, {});
  for (const [argv, message] of [
    [["frobnicate"], /unknown command "frobnicate"/],
    [["check", "a", "b"], /check takes one path/],
    [["check", "--format", "xml"], /--format must be text or json/],
    [["check", "--fail-on", "sometimes"], /--fail-on must be error, warning or never/],
    [["check", "--nope"], /Unknown option/],
    [["check", "./does-not-exist"], /not a directory/],
  ] as [string[], RegExp][]) {
    const x = io(cwd);
    assert.equal(run(argv, x), 2, argv.join(" "));
    assert.match(x.stderr, message);
    assert.equal(x.stdout, "");
  }
});

test("check is the default command, and the path defaults to the current folder", (t) => {
  const cwd = makeRepo(t, broken);
  const a = io(cwd);
  assert.equal(run([], a), 1);
  assert.match(a.stdout, /CLAUDE\.md/);
  const b = io(cwd);
  assert.equal(run(["check"], b), 1);
  assert.equal(a.stdout, b.stdout);
});

test("a path argument is read relative to the working folder", (t) => {
  const outer = makeRepo(t, { "inner/CLAUDE.md": "x\n", "inner/a.ts": "a" });
  const x = io(outer);
  assert.equal(run(["check", "inner"], x), 0);
  assert.match(x.stdout, /No problems found in 1 instruction file/);
});

test("exit code: 1 for errors, and --fail-on decides what counts", (t) => {
  const onlyWarning = makeRepo(t, { "CLAUDE.md": "See `src/gone.ts`.\n", "src/a.ts": "a" });
  assert.equal(run(["check"], io(onlyWarning)), 0, "a warning alone does not fail by default");
  assert.equal(run(["check", "--fail-on", "warning"], io(onlyWarning)), 1);
  assert.equal(run(["check", "--fail-on", "never"], io(makeRepo(t, broken))), 0);
  assert.equal(run(["check", "--fail-on", "error"], io(makeRepo(t, broken))), 1);
  assert.equal(run(["check"], io(makeRepo(t, { "CLAUDE.md": "clean\n" }))), 0);
});

test("--format json prints one JSON document", (t) => {
  const x = io(makeRepo(t, broken));
  assert.equal(run(["check", "--format", "json"], x), 1);
  const parsed = JSON.parse(x.stdout);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.findings.length, 2);
});

test("--all shows the less certain findings, and --no-git does not use Git", (t) => {
  const root = makeRepo(t, { "CLAUDE.md": "See `docs/api.md`.\n", "src/a.ts": "a" }, { git: true });
  const normal = io(root);
  run(["check"], normal);
  assert.match(normal.stdout, /1 less certain finding not shown/);
  const all = io(root);
  run(["check", "--all"], all);
  assert.match(all.stdout, /docs\/api\.md/);
  assert.doesNotMatch(all.stdout, /not shown/);
  const nogit = io(root);
  run(["check", "--no-git"], nogit);
  assert.match(nogit.stdout, /Git was not used/);
});

test("color only on a terminal, and never when NO_COLOR is set or the terminal is dumb", (t) => {
  const root = makeRepo(t, broken);
  const colored = io(root, { isTTY: true });
  run(["check"], colored);
  assert.match(colored.stdout, /\x1b\[/);
  for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }]) {
    const x = io(root, { isTTY: true, env });
    run(["check"], x);
    assert.doesNotMatch(x.stdout, /\x1b\[/);
  }
  const piped = io(root);
  run(["check"], piped);
  assert.doesNotMatch(piped.stdout, /\x1b\[/);
});
