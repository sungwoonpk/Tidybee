# Checks

Every check has an id, a severity and a confidence. They are shown with each finding.

- **Severity** says how much it matters: `error` is something that is certainly broken, `warning` is likely broken, `info` is worth knowing.
- **Confidence** says how sure Tidybee is that it is a real problem: `high`, `medium` or `low`. Findings below `medium` are not shown unless you run with `--all`, and the report says how many were left out.
- **Evidence.** When a path is gone, Tidybee asks Git. If Git remembers the file being deleted or renamed, the finding says in which commit and on what day, and names where it went. That is what makes it a high-confidence error.

## What is looked at

Tidybee finds the instruction files of every agent it knows. It reads them as Markdown and checks what they point at against the repository.

| File                                                                        | Agent                                       | Read                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CLAUDE.md`, `CLAUDE.local.md`                                              | Claude Code                                 | at the start of every session at the root, and for work in a folder when nested        |
| `AGENTS.md`, `AGENT.md`                                                     | Codex, opencode, Copilot and others         | the same                                                                               |
| `GEMINI.md`                                                                 | Gemini CLI                                  | the same                                                                               |
| `CONVENTIONS.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`           | Aider, and older Cursor, Windsurf and Cline | at the root                                                                            |
| `.cursor/rules/*.mdc`                                                       | Cursor                                      | always with `alwaysApply: true`, for matching files with `globs`, otherwise on request |
| `.windsurf/rules/*.md`                                                      | Windsurf                                    | by its `trigger:`                                                                      |
| `.clinerules/*.md`                                                          | Cline                                       | always                                                                                 |
| `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | GitHub Copilot                              | always, and for matching files                                                         |
| `.claude/commands/**`, `.claude/agents/*`, `.claude/skills/*/SKILL.md`      | Claude Code                                 | on request. A skill costs its name and description until it is used                    |
| `.kiro/steering/*.md`                                                       | Kiro                                        | by its `inclusion:`                                                                    |

## The checks

### `stale-path`

A path in a code span or a shell block that is not in the repository.

- A path is read from `` `code spans` `` and from shell blocks (no language, `sh`, `bash`, `shell`, `zsh`, `console`, `text`). Other languages and tree drawings are skipped, and so are comments in a shell block.
- It is looked for from the repository root and from the folder of the instruction file, so a nested `AGENTS.md` can name files next to it. `./` and `../` follow the file.
- **Case.** `src/Util.ts` where the file is `src/util.ts` works on a Mac and fails on Linux. It is reported with the real spelling.
- **Git evidence** makes it an `error` with high confidence: "It was renamed to `x` in 3fa9c1 on 2026-08-02."
- Without evidence, a path under a folder that exists is a `warning` with medium confidence. A path whose first folder does not exist is only an `info` with low confidence, since it may belong to another repository.
- **A bare file name** such as `settings.json` is reported only when Git remembers a file of that name that is gone. Otherwise it is too often something outside the repository, such as a user's own settings.

Left alone on purpose: URLs, `~/` and absolute paths, `@scope/package` names, wildcards and templates (`src/**/*.ts`, `{a,b}`, `$HOME/x`), a Go `./...` pattern, `.md` on its own, `path/to/file`, `your-app/`, `foo/bar` and other example paths, build output folders (`dist`, `build`, `coverage`, `node_modules`, and so on), paths that `.gitignore` covers, and a test id such as `tests/a.py::test_x` (the file is checked). A line that says it _writes_, _creates_, _generates_ or _installs_ something is naming a place a tool puts files, so paths on it are skipped.

### `stale-link`, `stale-anchor`

Markdown links `[text](path)` to a file that is gone, and `[text](file.md#heading)` or `[text](#heading)` to a heading that is not there. Links are read from the file's folder, or from the root when they start with `/`. The query string is ignored. Headings are matched the way GitHub makes anchors, including `-1`, `-2` for repeated headings. A missing file is a high-confidence error, and a missing heading a medium-confidence warning, since anchors can differ in small ways.

### `stale-import`, `import-cycle`, `import-depth`

`@path/to/file` imports, which Claude Code and Gemini CLI follow, in `CLAUDE.md` and `GEMINI.md`. An import of a file that is gone is an error, an import that loops back is a warning, and one nested more than five imports deep is a warning because the agent stops following it. A bare `@name` is a mention, not an import, so an import needs a slash or a dot. `~/` imports are left alone.

### `stale-command`

A command in a code span or a shell block that names something the repository does not have.

- `npm run x`, `pnpm x`, `yarn x`, `bun run x`: the script must be in **some** `package.json` in the repository. `npm test` needs a `test` script and `npm start` a `start` script (or a `server.js`). A monorepo's scripts count wherever they are.
- `make x`: the target must be in some Makefile, and if the repository has none that is said. `-C` and `-f` are not followed, and are not checked.
- `just x`: the recipe must be in the justfile.
- A command in a shell block is an `error`. In a code span it is a `warning`, since it may be an example.
- Not checked: a command with `<placeholders>`, commands scoped by `--filter`, `--workspace`, `-r` or `--prefix`, and global installs with `-g`.

### `package-manager`

The instruction file says `npm install` and the repository has a `pnpm-lock.yaml`. The package manager comes from the nearest lockfile going up from the instruction file, or from the `packageManager` field. If there is no lockfile there is nothing to disagree with. One warning for each package manager in a file, at the first place, naming the other lines.

### `stale-tree`

A folder tree drawn in a code block (`├──`, `└──`, `|--`, `+--`) whose entries are not in the repository. Each entry is checked, and when a folder is gone it is reported once and not again for everything inside it.

- **Where the tree starts.** The first line may name the project (or be a dot), and then the entries are at the root. It may be a path (`src/deep/ui/`) or just a folder name (`ui/`), which can exist in several places. Each place is tried and the one under which the most of the first-level entries really exist is taken, so `caveman/` at the top of a layout is not mistaken for `plugins/caveman/`.
- Names can be lists (`a, b` and `a / b`), comments after the name are dropped, and Git gives the same evidence as for paths.
- Left alone: the edges of boxes in diagrams, a first line with spaces or brackets (a picture of a screen, not of folders), examples, build output, ignored paths and entries with wildcards.

### `rule-header`

The header of the rule and skill files, against what each agent documents.

| File                        | Reported                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor `.mdc`               | `alwaysApply` that is not true or false (warning). No `description`, `globs` or `alwaysApply`, so it is used only when named (note). `globs` ignored because `alwaysApply` is true (note). `globs` that match no file (warning)             |
| Copilot `*.instructions.md` | Neither `applyTo` nor `description` (note). An `applyTo` that matches no file (warning)                                                                                                                                                     |
| Windsurf rules              | No `trigger`, an unknown one, `glob` with no `globs`, `model_decision` with no `description`, `globs` that match nothing                                                                                                                    |
| Skills (`SKILL.md`)         | No header, no `name` or no `description` (error). A name that is not lower-case letters, digits and single hyphens, at most 64 characters (warning). A name that is not the folder's name (note, since that is a convention and not a rule) |
| Claude agents               | No header, no `name` or no `description` (error). A name that is not lower case with hyphens (warning)                                                                                                                                      |

The glob matcher knows `*`, `**`, `?`, `[abc]` and `{a,b}` with braces inside braces. Some details were not found in the agents' own documents, so they are not checked: a maximum length for a skill's `description`, and the header of Kiro steering files.

### `identical-files`, `drifting-files`, `duplicate-content`, `repeated-statement`

The same instructions written in more than one place. A statement is a sentence or a list item, compared without case, emphasis or punctuation, and only if it is at least 50 characters. Two files are compared when they are read together (both at the start of every session) or sit in the same folder, and not when one imports the other.

- **identical-files:** the two say the same thing. Keep one and import it.
- **drifting-files:** mostly the same (60% or more), and each has statements the other lacks. This is the one that bites later, when someone edits only one copy.
- **duplicate-content:** many shared statements. When one file holds everything the other says, it says so and names how many more statements it has.
- **repeated-statement:** the same statement twice in one file.

### Quality: `file-size`, `context-budget`, `filler`, `pasted-output`, `todo-marker`, `shouting`, `duplicate-heading`, `empty-section`, `no-commands`

These are about the writing, not about what a file points at. Their limits are **judgment, not specification**, and every message says what was measured.

- **file-size:** a file read at the start of every session is a note over about 2,500 tokens and a warning over 5,000. One read only when needed is a note over 8,000.
- **context-budget:** the files read at the start of every session come to more than 8,000 tokens, shown on the largest.
- **filler:** advice a model follows anyway ("write clean code", "follow best practices", "you are a helpful expert", "think step by step"), with what it costs. A statement with a code span in it is about something particular and is never counted.
- **pasted-output:** a code block over 60 lines.
- **todo-marker:** `TODO`, `FIXME`, `XXX` or `TBD` in running text, in one finding for the file.
- **shouting:** 12 or more words in capitals for emphasis (`MUST`, `NEVER`, `IMPORTANT`).
- **duplicate-heading** and **empty-section:** the same heading twice at one level, and a heading with nothing under it.
- **no-commands:** a top-level file that never shows a command to build, test or run. Low confidence, so it is shown only with `--all`.

## Tokens

The report says about how many tokens an agent reads at the start of every session, from the files it always loads. It is an **estimate**: a word of up to nine letters is a token, a number costs a token for every three digits, and a mark costs half. It was tuned on two English paragraphs that the o200k tokenizer counts at 63 and 20 tokens, where it gives 63 and 17. Text made mostly of code, paths and identifiers has more tokens than it counts. Use it to compare files and to notice growth, and do not read it as a bill.

## Known limits

- Paths are read only from code spans and shell blocks, not from running text, to keep false positives down. A path written plainly in a sentence is not checked.
- Imports are checked only in `CLAUDE.md` and `GEMINI.md`, the files Tidybee knows to follow them. Other files may use `@` references too, as Cursor rules can, and those are not checked.
- A script in a nested workspace counts for the whole repository, so a script that exists only in the wrong package is not caught.
- A line such as "the installer writes `x`" is skipped even when `x` really is a stale reference. This was chosen after a real repository where it removed false errors.
- Git evidence is read from the last 5,000 commits. A shallow clone has less.
- Markdown is read with a small reader and not a full CommonMark parser, so an unusual construct can be misread.
- A tree is read by its indentation. A tree that mixes tabs, or a layout written as a plain indented list, is not read.
- The size limits in the quality checks are judgment. A repository that wants a larger file will see the note every run until there is a way to configure it.
- Statements are compared as written, so the same rule in other words is not found.
- An instruction file is read to 2 MB. A larger one is checked as far as that, and a `file-too-large` warning says so. At most 500 instruction files are checked in a repository, and the report says how many were left. Other files, such as `package.json`, are read to 5 MB.
- A glob longer than 300 characters or with more than 64 choices in its braces is not judged, so a header that uses one is never reported as matching nothing.
- A link whose target is over 2,000 characters, or whose text is over 500, is not read as a link.
