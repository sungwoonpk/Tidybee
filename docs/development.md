# Development

How Tidybee is built and checked. How to contribute is in [CONTRIBUTING.md](../CONTRIBUTING.md).

```bash
npm run check          # lint, format, types, and tests with coverage gates
```

## Tests

- **Unit tests** for the Markdown reader, the token estimate, the repository index, Git history, file discovery, each check, the report and the command runner.
- **Real Git repositories.** The tests make temporary repositories, commit, rename and delete files, and check that a missing path is explained by the right commit.
- **The real command line.** A test starts `tidybee` as a separate process and checks the output and the exit code.
- **Safety.** A repository with a hostile Git setting must not make Tidybee run a program, and a run must change nothing in the repository. The first was checked by taking the protection away and watching the test fail.
- **Hostile input.** `test/robustness.test.ts` feeds each reader lines made to make it slow (60,000 spaces after a heading, brackets that never close, a glob with forty `**`, a path of five thousand folders) and fails if one takes over a second and a half. These are the inputs that really did hang the first versions. Each protection was taken away in turn to see its test fail.
- **Coverage gates** are 95% of lines, 95% of functions and 85% of branches. CI fails below them.
- **The examples.** CI builds the command and runs it on `examples/healthy`, which must pass, and `examples/broken`, which must exit with 1 and name its problems.

## Run on real repositories

A check that finds nothing in tests proves little, so every check was run, read only, on three public repositories that have instruction files: [caveman](https://github.com/JuliusBrussee/caveman), [Next.js](https://github.com/vercel/next.js) and [VS Code](https://github.com/microsoft/vscode), each cloned with the last 300 commits.

| Repository | Instruction files | Findings shown                  | Left out as less certain | Time        |
| ---------- | ----------------- | ------------------------------- | ------------------------ | ----------- |
| caveman    | 30                | 4 errors, 67 warnings, 10 notes | 23                       | about 1.5 s |
| Next.js    | 13                | 7 warnings                      | 15                       | about 2.0 s |
| VS Code    | 38                | 4 errors, 26 warnings, 6 notes  | 45                       | about 4.8 s |

The time includes starting Node. These runs found false positives, and each was fixed and given a test.

First milestone:

- A Go pattern `./pkg/...` was read as a path, because the dots were trimmed before it was judged.
- `.md` and `.css` on their own were read as files.
- Bare names such as `settings.json` were reported even though they are usually a user's own file outside the repository.
- `path/to/test.ts` and other example paths were reported.
- A test id `tests/a.py::test_x` was read as one path.
- Lines such as "per-repo `.windsurf/rules/caveman.md` via `--with-init`" were reported as stale, because the installer writes those files into other repositories.

Structure and hygiene checks:

- A name list written `AGENTS.md / GEMINI.md` was read as one name.
- The edges of boxes in architecture diagrams (`└──────┬───┘`) were read as tree entries.
- A picture of a screen (`AI Customization (Tree View)`) was read as a folder tree.
- A tree that starts with a folder name (`ui/`, `caveman/`) was resolved in the wrong place when the name is used in several folders. It now takes the place where the most of the first-level entries exist.
- "Mostly the same" was said of a file that is only a part of another one. That is a copy of part and not drift, and it is now said so.
- Copilot instructions with a `description` and no `applyTo`, which VS Code supports, were reported.
- A nested glob `{oss/**,{win32,linux}/steps/*.yml}` matched nothing, and a header was wrongly reported. The matcher was rewritten for nested braces.

**What was checked by hand, and what was not.** Some findings were compared with the source: VS Code's `[index.ts](index.ts)` links point at files that are not in that folder. caveman's instruction files tell the agent to run `make test-browse` in a repository that has never had a Makefile, and caveman's `caveman-compress` folder was renamed while its `CLAUDE.md` kept the old path. VS Code's layout in `ai-customization.instructions.md` lists `aiCustomization.ts` and three more files that are not in that folder. caveman's layout lists `agents/docs/`, which Git shows was deleted. `extension/AGENTS.md` and `extension/CLAUDE.md` really are identical, and `mcp/AGENTS.md` really is part of `mcp/CLAUDE.md`. All of these are real. The other findings, about 120 in total, were **not** read one by one, so some of them may be false positives.
