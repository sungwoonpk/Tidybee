# Tidybee

[![CI](https://github.com/sungwoonpk/Tidybee/actions/workflows/ci.yml/badge.svg)](https://github.com/sungwoonpk/Tidybee/actions/workflows/ci.yml)
[![CodeQL](https://github.com/sungwoonpk/Tidybee/actions/workflows/codeql.yml/badge.svg)](https://github.com/sungwoonpk/Tidybee/actions/workflows/codeql.yml)

A doctor for the files that coding agents read: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor, Windsurf, Cline and Copilot rules, and Claude skills. It checks that every path, link, import and command they mention is still there, tells you which commit removed or renamed what is gone, finds rules that contradict each other, keys, hidden text and risky advice, and says how many tokens they cost at the start of every session.

TypeScript, no runtime dependencies, read-only. It is meant to be run on repositories you did not write.

```
$ tidybee check examples/broken
CLAUDE.md
  3:31    error   `@docs/rules.md` imports a file that does not exist. stale-import
  7:57    warning `src/old-parser.ts` does not exist in this repository. stale-path
  8:17    error   The link `docs/guide.md` points at a file that does not exist. stale-link
  8:48    warning The link `docs/history.md#why-we-rewrote-it` points at a heading that is not in `docs/history.md`. stale-anchor
  13:1    warning Uses npm, but this repository's lockfile is pnpm's. The same on lines 14, 15, 16. package-manager
          -> Use pnpm.
  15:1    error   `npm run lint` runs the script `lint`, which no package.json in this repository defines. stale-command
  19:6    warning `make check` needs a Makefile, and this repository has none. stale-command

7 problems (3 errors, 4 warnings) in 1 instruction file, about 98 tokens read at the start of every session.
```

## Why

An instruction file is written once and then the code moves on. The agent trusts it every session.

| What goes wrong                                            | What Tidybee does                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CLAUDE.md` names a file that was renamed months ago       | Says so, with the commit and the day, and where the file went          |
| It says `npm run lint` and there is no such script         | Checks every script, make target and recipe against the repository     |
| It says `npm`, the repository uses `pnpm`                  | Compares with the lockfile                                             |
| A link or an `@import` points at a document that was moved | Checks files and headings                                              |
| One file says tabs and another says spaces                 | Finds rules that say the opposite, in files an agent reads together    |
| A key was pasted in, or text is hidden where nobody looks  | Finds keys, invisible characters, and hidden comments that give orders |
| The files grow, and every session pays for them in tokens  | Counts the tokens read at the start of every session                   |
| A checker that is often wrong gets switched off            | Every finding has a confidence. The unsure ones are hidden and counted |

## Features

- **Finds the instruction files of many agents,** and knows which are read always, for some files, or only on request.
- **Finds copies that drifted.** `CLAUDE.md` and `AGENTS.md` often start as one text and end as two. Tidybee says how far they have moved apart.
- **Evidence from Git.** A missing path that Git remembers being deleted or renamed is a certain error, and says where it went.
- **Honest about doubt.** Findings are `high`, `medium` or `low` confidence, and `low` ones need `--all`.
- **Never prints a secret,** and never lets text from a repository change what your terminal shows. See [decision 0006](docs/decisions/0006-safety-findings-never-print-secrets.md).
- **Safe on other people's code.** It only reads. It never runs a script from the repository, and it runs Git with the setting that lets a repository run a program turned off.
- **Checked on real repositories,** not only on tests. See [development](docs/development.md).

## Run it

Needs Node 22.13 or newer. It is not on npm, so it runs from a clone.

```bash
git clone https://github.com/sungwoonpk/Tidybee.git
cd Tidybee
npm install
npm run dev -- check examples/broken     # a sample with problems in it
npm run dev -- check /path/to/your/repo
```

Or build it and use the command: `npm run build`, then `node dist/src/cli.js check .`.

| Option                                | Meaning                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `--format text` or `json`             | How to print the result. The JSON is versioned                  |
| `--fail-on error`, `warning`, `never` | The lowest severity that makes the exit code 1. Default `error` |
| `--all`                               | Also show findings Tidybee is less sure about                   |
| `--no-git`                            | Do not use Git, even in a repository                            |

Exit codes: `0` when nothing at or above `--fail-on` was found, `1` when something was, `2` when it could not run.

## What it checks

| Check                                                    | Finds                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `stale-path`                                             | A path in a code span or a shell block that is not in the repository       |
| `stale-link`, `stale-anchor`                             | A Markdown link to a missing file or heading                               |
| `stale-import`, `import-cycle`, `import-depth`           | An `@import` that is missing, loops, or nests deeper than five             |
| `stale-command`                                          | An `npm run`, `make` or `just` that names something that is not there      |
| `package-manager`                                        | `npm` in a `pnpm` repository, and the like                                 |
| `stale-tree`                                             | A folder tree in the text whose entries are no longer in the repository    |
| `rule-header`                                            | Bad headers in Cursor, Copilot and Windsurf rules, skills and agents       |
| `drifting-files`, `identical-files`, `duplicate-content` | The same instructions in several files, and copies that drifted            |
| `file-size`, `filler`, `todo-marker` and others          | Files that are too large, generic advice, unfinished parts, empty sections |
| `contradiction`                                          | Opposite rules about indentation, quotes, the package manager, committing  |
| `secret`, `personal-path`                                | A pasted key, and a path on one person's computer                          |
| `invisible-text`, `prompt-injection`                     | Hidden characters, and orders hidden in a comment                          |
| `risky-command`                                          | `curl \| sh`, skipped permission prompts, `curl -k`, `rm -rf /`            |

How each one works, and what it leaves alone on purpose, is in [docs/checks.md](docs/checks.md).

## Checks for the project

```bash
npm run check       # lint, format, types, and tests with coverage gates
```

CI runs the same on Node 22 and 24, builds the command and runs it on the examples, audits the dependencies, and runs CodeQL.

## Docs

|                                                          |                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Checks](docs/checks.md)                                 | Every check, what it leaves alone, and its limits                                   |
| [Architecture](docs/architecture.md)                     | How a run flows, the code layout, and why it is safe on other people's repositories |
| [Decisions](docs/decisions/README.md)                    | Why it is built this way, and what each choice costs                                |
| [Development](docs/development.md)                       | Tests, and the run on real repositories with what was and was not checked by hand   |
| [Limits and roadmap](docs/limits.md)                     | What it does not do yet, and what is next                                           |
| [Contributing](CONTRIBUTING.md), [Security](SECURITY.md) | Working on it, and reporting a problem                                              |

## Status

It reads and checks, and does not fix anything yet. Configuration, SARIF and a GitHub Action, fixing and syncing are planned and listed in [docs/limits.md](docs/limits.md). The contradiction check reads few sentences on purpose, and the secret check is not a secret scanner. It has had no independent security review.
