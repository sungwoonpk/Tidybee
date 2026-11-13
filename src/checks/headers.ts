import type { Context, Doc } from "../analyze.js";
import { anyMatch, splitGlobs } from "../glob.js";
import type { Finding } from "../types.js";

// Checks the header (the "frontmatter") of the rule and skill files that agents read, against what each agent documents.
// Where a rule is only a convention and not a requirement, it is a note and not a warning.

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => splitGlobs(String(v)));
  return typeof value === "string" ? splitGlobs(value) : [];
}

/** The line of a header key, or 1. */
function lineOf(doc: Doc, key: string): number {
  const end = doc.md.frontmatter?.endLine ?? 0;
  for (let i = 0; i < end && i < doc.md.lines.length; i++) {
    const rest = (doc.md.lines[i] as string).startsWith(key)
      ? (doc.md.lines[i] as string).slice(key.length).trimStart()
      : null;
    if (rest !== null && rest.startsWith(":")) return i + 1;
  }
  return 1;
}

function cursor(ctx: Context, d: Doc, out: Finding[]): void {
  if (!d.file.path.endsWith(".mdc")) return; // a plain .md file in the rules folder has no header to check
  const fm = d.md.frontmatter?.data ?? {};
  const add = (key: string, f: Omit<Finding, "file" | "line" | "column">): void =>
    void out.push({ file: d.file.path, line: lineOf(d, key), column: 1, ...f });

  if (fm.alwaysApply !== undefined && typeof fm.alwaysApply !== "boolean") {
    add("alwaysApply", {
      rule: "rule-header",
      severity: "warning",
      confidence: "high",
      message: `\`alwaysApply\` must be true or false, and here it is "${String(fm.alwaysApply)}" in quotes or as something else, so Cursor does not treat it as set.`,
    });
  }
  const globs = toList(fm.globs);
  const hasDescription = typeof fm.description === "string" && fm.description.trim() !== "";
  if (fm.alwaysApply === true && globs.length > 0) {
    add("globs", {
      rule: "rule-header",
      severity: "info",
      confidence: "medium",
      message: "`globs` is ignored, because `alwaysApply` is true and the rule is always included.",
    });
  }
  if (fm.alwaysApply !== true && globs.length === 0 && !hasDescription) {
    add("description", {
      rule: "rule-header",
      severity: "info",
      confidence: "medium",
      message:
        "This rule has no `description`, no `globs` and no `alwaysApply`, so Cursor uses it only when someone names it.",
    });
  }
  if (fm.alwaysApply !== true && globs.length > 0 && anyMatch(globs, ctx.index.files) === false) {
    add("globs", {
      rule: "rule-header",
      severity: "warning",
      confidence: "medium",
      subject: globs.join(", "),
      message: `None of the files in the repository match \`${globs.join(", ")}\`, so this rule is never attached.`,
    });
  }
}

function copilotScoped(ctx: Context, d: Doc, out: Finding[]): void {
  const fm = d.md.frontmatter?.data ?? {};
  const applyTo = toList(fm.applyTo);
  const hasDescription = typeof fm.description === "string" && fm.description.trim() !== "";
  if (applyTo.length === 0 && !hasDescription) {
    out.push({
      file: d.file.path,
      line: 1,
      column: 1,
      rule: "rule-header",
      severity: "info",
      confidence: "medium",
      message:
        "This instructions file has no `applyTo` and no `description`, so Copilot has no way to decide when to use it.",
    });
  } else if (applyTo.length > 0 && anyMatch(applyTo, ctx.index.files) === false) {
    out.push({
      file: d.file.path,
      line: lineOf(d, "applyTo"),
      column: 1,
      rule: "rule-header",
      severity: "warning",
      confidence: "medium",
      subject: applyTo.join(", "),
      message: `None of the files in the repository match \`${applyTo.join(", ")}\`, so this file never applies.`,
    });
  }
}

const TRIGGERS = new Set(["always_on", "model_decision", "glob", "manual"]);

function windsurf(ctx: Context, d: Doc, out: Finding[]): void {
  const fm = d.md.frontmatter?.data ?? {};
  const add = (key: string, f: Omit<Finding, "file" | "line" | "column">): void =>
    void out.push({ file: d.file.path, line: lineOf(d, key), column: 1, ...f });
  const trigger = typeof fm.trigger === "string" ? fm.trigger : undefined;
  if (trigger === undefined) {
    add("trigger", {
      rule: "rule-header",
      severity: "warning",
      confidence: "medium",
      message:
        "This rule has no `trigger`, which says when Windsurf uses it (always_on, model_decision, glob or manual).",
    });
    return;
  }
  if (!TRIGGERS.has(trigger)) {
    add("trigger", {
      rule: "rule-header",
      severity: "warning",
      confidence: "high",
      subject: trigger,
      message: `\`trigger: ${trigger}\` is not one of always_on, model_decision, glob or manual.`,
    });
    return;
  }
  const globs = toList(fm.globs);
  if (trigger === "glob" && globs.length === 0) {
    add("trigger", {
      rule: "rule-header",
      severity: "warning",
      confidence: "high",
      message: "The trigger is `glob` and there are no `globs`, so the rule never applies.",
    });
  } else if (trigger === "glob" && anyMatch(globs, ctx.index.files) === false) {
    add("globs", {
      rule: "rule-header",
      severity: "warning",
      confidence: "medium",
      subject: globs.join(", "),
      message: `None of the files in the repository match \`${globs.join(", ")}\`.`,
    });
  }
  if (trigger === "model_decision" && !(typeof fm.description === "string" && fm.description.trim() !== "")) {
    add("trigger", {
      rule: "rule-header",
      severity: "warning",
      confidence: "high",
      message:
        "The trigger is `model_decision` and there is no `description`, which is what the model reads to decide.",
    });
  }
}

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function skillOrAgent(d: Doc, out: Finding[]): void {
  const fm = d.md.frontmatter?.data ?? {};
  const what = d.file.kind === "skill" ? "skill" : "agent";
  const missing = (key: string): boolean => !(typeof fm[key] === "string" && (fm[key] as string).trim() !== "");
  const add = (key: string, f: Omit<Finding, "file" | "line" | "column">): void =>
    void out.push({ file: d.file.path, line: lineOf(d, key), column: 1, ...f });

  if (!d.md.frontmatter) {
    out.push({
      file: d.file.path,
      line: 1,
      column: 1,
      rule: "rule-header",
      severity: "error",
      confidence: "high",
      message: `A ${what} file needs a header with a \`name\` and a \`description\`, and this has none.`,
    });
    return;
  }
  for (const key of ["name", "description"]) {
    if (missing(key))
      add(key, {
        rule: "rule-header",
        severity: "error",
        confidence: "high",
        message: `The ${what} has no \`${key}\`, which is required.`,
      });
  }
  const name = typeof fm.name === "string" ? fm.name : "";
  if (name !== "") {
    if (d.file.kind === "skill" && (!SKILL_NAME.test(name) || name.length > 64)) {
      add("name", {
        rule: "rule-header",
        severity: "warning",
        confidence: "high",
        subject: name,
        message: `The skill name \`${name}\` should be lower-case letters, digits and single hyphens, at most 64 characters, with no hyphen at either end.`,
      });
    }
    if (d.file.kind === "claude-agent" && !/^[a-z][a-z0-9-]*$/.test(name)) {
      add("name", {
        rule: "rule-header",
        severity: "warning",
        confidence: "medium",
        subject: name,
        message: `The agent name \`${name}\` should be lower-case letters and hyphens.`,
      });
    }
    if (d.file.kind === "skill") {
      const folder = d.file.dir.split("/").pop();
      if (SKILL_NAME.test(name) && folder !== name) {
        add("name", {
          rule: "rule-header",
          severity: "info",
          confidence: "medium",
          subject: name,
          message: `The skill is named \`${name}\` and lives in the folder \`${folder}\`. By convention the two are the same.`,
        });
      }
    }
  }
}

export function headers(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const d of ctx.docs) {
    switch (d.file.kind) {
      case "cursor-rule":
        cursor(ctx, d, out);
        break;
      case "copilot-scoped":
        copilotScoped(ctx, d, out);
        break;
      case "windsurf-rule":
        windsurf(ctx, d, out);
        break;
      case "skill":
      case "claude-agent":
        skillOrAgent(d, out);
        break;
      default:
    }
  }
  return out;
}
