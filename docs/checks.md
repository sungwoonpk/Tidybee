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

## Tokens

The report says about how many tokens an agent reads at the start of every session, from the files it always loads. It is an **estimate**: a word of up to nine letters is a token, a number costs a token for every three digits, and a mark costs half. It was tuned on two English paragraphs that the o200k tokenizer counts at 63 and 20 tokens, where it gives 63 and 17. Text made mostly of code, paths and identifiers has more tokens than it counts. Use it to compare files and to notice growth, and do not read it as a bill.

## Known limits

- Paths are read only from code spans and shell blocks, not from running text, to keep false positives down. A path written plainly in a sentence is not checked.
- Imports are checked only in `CLAUDE.md` and `GEMINI.md`, the files Tidybee knows to follow them. Other files may use `@` references too, as Cursor rules can, and those are not checked.
- A script in a nested workspace counts for the whole repository, so a script that exists only in the wrong package is not caught.
- A line such as "the installer writes `x`" is skipped even when `x` really is a stale reference. This was chosen after a real repository where it removed false errors.
- Git evidence is read from the last 5,000 commits. A shallow clone has less.
- Markdown is read with a small reader and not a full CommonMark parser, so an unusual construct can be misread.
