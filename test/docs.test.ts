import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { run } from "../src/run.js";

// The README shows what Tidybee prints for the broken example. This keeps that sample the real output.
const root = fileURLToPath(new URL("..", import.meta.url));

test("the sample in the README is what Tidybee prints for examples/broken", () => {
  const readme = readFileSync(`${root}/README.md`, "utf8");
  const block = /```\n\$ tidybee check examples\/broken\n([\s\S]*?)```/.exec(readme);
  assert.ok(block, "the README has a sample for examples/broken");
  let out = "";
  const code = run(["check", "examples/broken"], {
    out: (t) => void (out += t),
    err: () => undefined,
    cwd: root,
    isTTY: false,
    env: {},
  });
  assert.equal(code, 1);
  assert.equal(out.trimEnd(), (block[1] as string).trimEnd());
});

test("the broken example breaks every kind of reference, and the healthy example breaks none", () => {
  const rules = (path: string) => {
    let out = "";
    run(["check", path, "--format", "json"], {
      out: (t) => void (out += t),
      err: () => undefined,
      cwd: root,
      isTTY: false,
      env: {},
    });
    return (JSON.parse(out) as { findings: { rule: string }[] }).findings.map((f) => f.rule);
  };
  assert.deepEqual([...new Set(rules("examples/broken"))].sort(), [
    "package-manager",
    "stale-anchor",
    "stale-command",
    "stale-import",
    "stale-link",
    "stale-path",
  ]);
  assert.deepEqual(rules("examples/healthy"), []);
});

test("the messy example trips the structure and hygiene checks", () => {
  let out = "";
  run(["check", "examples/messy", "--format", "json"], {
    out: (t) => void (out += t),
    err: () => undefined,
    cwd: root,
    isTTY: false,
    env: {},
  });
  const rules = new Set((JSON.parse(out) as { findings: { rule: string }[] }).findings.map((f) => f.rule));
  for (const rule of ["rule-header", "stale-tree", "drifting-files", "filler", "todo-marker", "empty-section"]) {
    assert.ok(rules.has(rule), `examples/messy should trip ${rule}, and it tripped ${[...rules].join(", ")}`);
  }
});

test("the unsafe example trips the contradiction and safety checks, and leaves its own warnings alone", () => {
  let out = "";
  run(["check", "examples/unsafe", "--format", "json"], {
    out: (t) => void (out += t),
    err: () => undefined,
    cwd: root,
    isTTY: false,
    env: {},
  });
  const findings = (JSON.parse(out) as { findings: { rule: string; subject?: string }[] }).findings;
  const rules = new Set(findings.map((f) => f.rule));
  for (const rule of ["contradiction", "personal-path", "risky-command", "prompt-injection"]) {
    assert.ok(rules.has(rule), `examples/unsafe should trip ${rule}, and it tripped ${[...rules].join(", ")}`);
  }
  // The file says "Never run `rm -rf /`" and "never use `curl -k`", which warns against them and does not ask for them.
  const risky = findings.filter((f) => f.rule === "risky-command").map((f) => f.subject);
  assert.equal(risky.length, 2);
  assert.ok(!risky.some((s) => s?.includes("rm -rf") || s?.includes("curl -k")));
});
