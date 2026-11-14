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

### `contradiction`

Two rules that say the opposite, for an agent that reads both. It knows a short list of topics and says nothing about any other: indentation (tabs, or a number of spaces), line length, semicolons, single or double quotes, trailing commas, ES modules or CommonJS, the test runner (Jest, Vitest, Mocha, pytest and others), the formatter (Prettier, Biome, dprint), whether to commit or push without being asked, and the package manager.

- **A rule tells, and does not describe.** A statement counts when it starts with an instruction or has a `must` or `should` in it. For line length, the test runner and the formatter a plain statement of fact counts too.
- **Left out of a pair:** a statement with a condition (`when`, `if`, `unless`, `except`, `but`), a rule for one use (`for user-visible strings`, `everything else`, `all other files`), a statement about the past (`old`, `previously`, `migrated`, `was`), and a name used as a comparison (`like Jest`, `Jest-like`, `instead of npm`). "Unless I ask" is not a condition for committing and pushing.
- **Scope.** A language or part of the project named in the statement or its heading (`Python`, `tests`, `frontend`, `packages/app`) puts it in that scope, and two statements are compared only within one: "Go uses tabs" and "Python uses 4 spaces" do not disagree. Commands that run after a `cd` are in that folder. The package manager, test runner, formatter, committing and pushing are about the whole repository, so only a folder keeps them apart.
- **Which files.** Only files an agent reads together: the same file, two files that are both read at the start of every session, or two files in one folder. A nested file may change what the root says. The finding has `medium` confidence, and `low` for two files that only share a folder.
- **The package manager** is reported only where no lockfile decides, since `package-manager` says which commands are wrong when there is one. `npm publish` and `npm install -g` choose nothing, and `Use pnpm, not npm` chooses pnpm.
- One finding for each topic and scope, at the second statement, naming the first.

This reads few sentences, on purpose. See [decision 0007](decisions/0007-contradictions-are-narrow-on-purpose.md) for what it found on real repositories and what it misses.

### Safety: `secret`, `personal-path`, `invisible-text`, `prompt-injection`, `risky-command`

An instruction file is committed, read by every agent that opens the repository, and often pasted into a chat. These checks look for what should not be in it. See [decision 0006](decisions/0006-safety-findings-never-print-secrets.md).

**`secret`.** A key that was pasted into the file. A finding shows the first four characters and the length, and never the value.

- **A known shape** is an error with high confidence: AWS access key IDs, GitHub tokens, Anthropic and OpenAI keys, Slack tokens and webhooks, Stripe live keys, Google API keys, npm and Hugging Face tokens, SendGrid keys, Discord webhooks, and a private key with its encoded body after the header. A placeholder is not one: `example`, `your`, `xxxx`, a run of one character, the alphabet in order, or too little entropy.
- **A JSON Web Token** is a warning, except the one from jwt.io. **A password in a URL** (`scheme://user:password@host`) is a warning when it looks random, and not `user:password` or a variable.
- **A value assigned to a name** such as `api_key`, `token` or `password` is a warning with medium confidence when it is 20 or more characters of high entropy, and low confidence otherwise. It needs a digit and a letter, and is not a name (`my-service-name-123`), an environment variable, a reference (`${{ secrets.X }}`) or a UUID.
- Secrets are looked for in every line, including the header, code blocks and HTML comments.

**`personal-path`.** `/Users/maria/Projects/app` or `C:\Users\maria\Desktop` is a place on one person's computer. It does not exist for anyone else and gives away a user name. Warning, medium confidence. `/home/name/` is low confidence, since `/home/` is also a page in a web application. Not reported: `/Users/you`, `/Users/<name>`, `/home/runner`, `/home/node`, `/Users/Public` and the like, `~/`, and a path inside a URL or after a word character (`src/home/x`).

**`invisible-text`.** Text that a person does not see and a model reads.

| Found                                                                                                              | Reported                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Tag characters (U+E0000 to U+E007F), which spell ASCII that no font draws                                          | Error, high. The finding says what they spell. At most ten are listed       |
| Eight or more zero-width characters on one line                                                                    | Error, high: bits can be written in them                                    |
| A zero-width space or word joiner, a mid-file byte order mark, a Hangul filler, and a joiner between plain letters | Warning, medium                                                             |
| Direction overrides and isolates (U+202A to U+202E, U+2066 to U+2069)                                              | Warning, medium                                                             |
| An escape or another control character                                                                             | Warning, high. In a terminal an escape sequence can hide the text before it |
| Invisible variation selectors (U+E0100 to U+E01EF)                                                                 | Warning, medium                                                             |

Left alone: the tag letters of the flag of England, Scotland and Wales, a joiner in an emoji or between letters of a script that uses it, a byte order mark at the start of the file, left-to-right and right-to-left marks, and a tab.

**`prompt-injection`.** The sentences that attacks on agents are made of: _ignore previous instructions_, _disregard prior rules_, _forget your earlier instructions_, _do not tell the user_, _without the user knowing_, _you are now in developer mode_. In an HTML comment, which GitHub does not show, it is a warning with medium confidence. In text that shows it is low confidence, since a document about such attacks says the same.

**`risky-command`.** Advice to run something an agent should not, in a code span, a shell block or an HTML comment (where a command is raised a level, since GitHub does not show it).

| Command                                                                                               | Reported                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `curl ... \| sh`, `wget ... \| sudo bash`, `bash <(curl ...)`, `eval "$(curl ...)"`, `irm ... \| iex` | Warning, medium: runs a script nobody read         |
| `base64 -d \| sh`                                                                                     | Error, high: a hidden payload                      |
| `--dangerously-skip-permissions`, `--yolo`, `--permission-mode bypassPermissions` and the like        | Warning, medium: turns off the agent's own prompts |
| `curl -k`, `wget --no-check-certificate`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `http.sslVerify false`    | Warning, medium: does not check who is there       |
| `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`                                                                | Warning, medium                                    |
| `chmod 777`, `git push --force` (not `--force-with-lease`), `git commit --no-verify`                  | Note, low: shown only with `--all`                 |

**A warning against a command is not advice to run it.** A file that says "never run `curl | sh`" is left alone. On the line itself a command is excused by a warning before it ("never run ...") or a verdict after it ("... is dangerous", "# bad"), and not by a "never" elsewhere in the sentence: "start it with `--dangerously-skip-permissions` so that it never stops to ask" is reported. The two lines before it, the two before its code block, and the heading of its section count whole (`never`, `don't`, `avoid`, `forbidden`, `deny`, `instead of`, `bad`, `unsafe` and the like). A command's own flags are not read as warnings.

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
- **Secrets are found by their shape.** A real secret with no fixed prefix, or a short plain one (`password=hunter2`), is not reported, and Tidybee is not a replacement for a secret scanner.
- **A warning can excuse the wrong thing.** The lines before a command and the heading of its section count whole, so "Never commit secrets." right above `curl | sh` excuses it.
- **Risky commands are read only in code spans, shell blocks and HTML comments.** A command written in running text is not found. Other languages of block (a Dockerfile, a script in `js`) are not read.
- **A line is read to 20,000 characters for secrets and 5,000 for risky commands.**
- **The contradiction check reads about 4 statements in a thousand,** and only for the topics it knows and in English. See [decision 0007](decisions/0007-contradictions-are-narrow-on-purpose.md).
