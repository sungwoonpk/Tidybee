import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/analyze.js";
import { headers } from "../src/checks/headers.js";
import { makeRepo } from "./helpers.js";

const run = (root: string) => headers(buildContext(root));
const rules = (fs: { file: string; severity: string; confidence: string }[]) =>
  fs.map((f) => `${f.file}|${f.severity}|${f.confidence}`);
const header = (...lines: string[]) => `---\n${lines.join("\n")}\n---\nBody.\n`;
const files = { "src/a.ts": "a", "docs/b.md": "b" };

test("Cursor: a quoted alwaysApply is not a boolean", (t) => {
  const root = makeRepo(t, { ".cursor/rules/x.mdc": header('alwaysApply: "true"'), ...files });
  const [f] = run(root);
  assert.deepEqual([f?.severity, f?.confidence, f?.line], ["warning", "high", 2]);
  assert.match(f?.message ?? "", /must be true or false/);
});

test("Cursor: a rule with no description, globs or alwaysApply is used only when named, and the other types are fine", (t) => {
  const none = run(makeRepo(t, { ".cursor/rules/x.mdc": "Just text, no header.\n", ...files }));
  assert.deepEqual(rules(none), [".cursor/rules/x.mdc|info|medium"]);
  assert.match(none[0]?.message ?? "", /only when someone names it/);
  assert.deepEqual(run(makeRepo(t, { ".cursor/rules/a.mdc": header("alwaysApply: true"), ...files })), []);
  assert.deepEqual(
    run(makeRepo(t, { ".cursor/rules/a.mdc": header("description: When editing TypeScript"), ...files })),
    [],
  );
  assert.deepEqual(run(makeRepo(t, { ".cursor/rules/a.mdc": header('globs: "src/**/*.ts"'), ...files })), []);
});

test("Cursor: globs are ignored when the rule always applies, and globs that match nothing are reported", (t) => {
  const both = run(makeRepo(t, { ".cursor/rules/a.mdc": header("alwaysApply: true", 'globs: "src/**"'), ...files }));
  assert.match(both[0]?.message ?? "", /`globs` is ignored/);
  const none = run(
    makeRepo(t, { ".cursor/rules/a.mdc": header("globs:", "  - app/**/*.py", "  - lib/*.go"), ...files }),
  );
  assert.deepEqual(rules(none), [".cursor/rules/a.mdc|warning|medium"]);
  assert.equal(none[0]?.subject, "app/**/*.py, lib/*.go");
  assert.equal(none[0]?.line, 2);
});

test("Cursor: a plain .md file in the rules folder is not checked", (t) => {
  assert.deepEqual(run(makeRepo(t, { ".cursor/rules/a.md": "no header at all\n", ...files })), []);
});

test("Copilot: with neither applyTo nor description it has no way to be chosen, and either one is enough", (t) => {
  const none = run(makeRepo(t, { ".github/instructions/a.instructions.md": "Body.\n", ...files }));
  assert.deepEqual(rules(none), [".github/instructions/a.instructions.md|info|medium"]);
  assert.deepEqual(
    run(makeRepo(t, { ".github/instructions/a.instructions.md": header("description: Chat code"), ...files })),
    [],
  );
  assert.deepEqual(
    run(makeRepo(t, { ".github/instructions/a.instructions.md": header('applyTo: "**/*.ts,**/*.tsx"'), ...files })),
    [],
  );
});

test("Copilot: an applyTo that matches no file never applies", (t) => {
  const [f] = run(
    makeRepo(t, { ".github/instructions/a.instructions.md": header('applyTo: "**/*.rs, **/*.go"'), ...files }),
  );
  assert.deepEqual([f?.severity, f?.confidence, f?.subject], ["warning", "medium", "**/*.rs, **/*.go"]);
});

test("Windsurf: the trigger must be there, be a known one, and have what it needs", (t) => {
  const r = (h: string) => run(makeRepo(t, { ".windsurf/rules/a.md": h, ...files }));
  assert.match(r("No header\n")[0]?.message ?? "", /no `trigger`/);
  assert.match(
    r(header("trigger: sometimes"))[0]?.message ?? "",
    /not one of always_on, model_decision, glob or manual/,
  );
  assert.match(r(header("trigger: glob"))[0]?.message ?? "", /no `globs`/);
  assert.match(r(header("trigger: glob", "globs: app/**"))[0]?.message ?? "", /None of the files/);
  assert.match(r(header("trigger: model_decision"))[0]?.message ?? "", /no `description`/);
  assert.deepEqual(r(header("trigger: always_on")), []);
  assert.deepEqual(r(header("trigger: manual")), []);
  assert.deepEqual(r(header("trigger: glob", "globs: src/**")), []);
  assert.deepEqual(r(header("trigger: model_decision", "description: When asked about billing")), []);
});

test("skills: a header with a name and a description is needed", (t) => {
  const none = run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": "No header.\n" }));
  assert.deepEqual(rules(none), [".claude/skills/pdf/SKILL.md|error|high"]);
  const noName = run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": header("description: Works with PDFs") }));
  assert.match(noName[0]?.message ?? "", /no `name`, which is required/);
  const noDesc = run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": header("name: pdf", "description: ") }));
  assert.match(noDesc[0]?.message ?? "", /no `description`/);
  assert.deepEqual(
    run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": header("name: pdf", "description: Works with PDFs") })),
    [],
  );
});

test("skills: the name has a form, and by convention it is the folder's name", (t) => {
  const bad = run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": header("name: PDF_Tool", "description: x") }));
  assert.deepEqual(rules(bad), [".claude/skills/pdf/SKILL.md|warning|high"]);
  for (const name of ["-pdf", "pdf-", "a--b", "x".repeat(65)]) {
    assert.equal(
      run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": header(`name: ${name}`, "description: x") })).filter(
        (f) => f.severity === "warning",
      ).length,
      1,
      name,
    );
  }
  const folder = run(makeRepo(t, { ".claude/skills/pdf/SKILL.md": header("name: pdf-tools", "description: x") }));
  assert.deepEqual(rules(folder), [".claude/skills/pdf/SKILL.md|info|medium"]);
  assert.match(folder[0]?.message ?? "", /By convention the two are the same/);
});

test("agents: a name and a description are required, and the name is lower case with hyphens", (t) => {
  assert.deepEqual(rules(run(makeRepo(t, { ".claude/agents/a.md": "No header.\n" }))), [
    ".claude/agents/a.md|error|high",
  ]);
  assert.equal(run(makeRepo(t, { ".claude/agents/a.md": header("name: a") })).length, 1);
  const bad = run(makeRepo(t, { ".claude/agents/a.md": header("name: Code Reviewer", "description: Reviews code") }));
  assert.deepEqual(rules(bad), [".claude/agents/a.md|warning|medium"]);
  assert.deepEqual(
    run(makeRepo(t, { ".claude/agents/a.md": header("name: code-reviewer", "description: Reviews code") })),
    [],
  );
});

test("other files have no header to check", (t) => {
  assert.deepEqual(
    run(
      makeRepo(t, {
        "CLAUDE.md": "x\n",
        "AGENTS.md": "y\n",
        ".claude/commands/c.md": "z\n",
        ".kiro/steering/s.md": "w\n",
      }),
    ),
    [],
  );
});
