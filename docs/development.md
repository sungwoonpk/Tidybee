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
- **Hostile input.** `test/robustness.test.ts` feeds each reader lines made to make it slow (60,000 spaces after a heading, brackets that never close, a glob with forty `**`, a path of five thousand folders) and fails if one takes over a second and a half. These are the inputs that really did hang the first versions. Each protection was taken away in turn to see its test fail. The safety checks are tried the same way, with 1.5 MB of a repeated start of a key, a download, a pipe or a path put in running text, a shell block, a comment and a code span, and the contradiction check with a hundred thousand statements. Without the limits on repeated parts the slowest of them took about two seconds instead of a tenth, and without the windows that read a long line a piece at a time as well, one did not finish in two minutes. The first version of these tests put the text only in running text, where the risk check never looks, and passed with the protections removed. That was found by removing them.
- **No secret in the repository.** The tests for secrets build each key when they run, from a fixed seed, and check that no field of a finding contains the key. Hidden characters are written as `\u{...}`. The repository holds nothing that a secret scanner would stop a push for.
- **Terminal output.** A report with an escape sequence and a direction override in a file name, a message and a suggestion must print neither.
- **Coverage gates** are 95% of lines, 95% of functions and 85% of branches. CI fails below them.
- **The examples.** CI builds the command and runs it on `examples/healthy`, which must pass, and `examples/broken`, which must exit with 1 and name its problems.

## Run on real repositories

A check that finds nothing in tests proves little, so every check was run, read only, on public repositories that have instruction files: [caveman](https://github.com/JuliusBrussee/caveman) (with its history), [Next.js](https://github.com/vercel/next.js) and [VS Code](https://github.com/microsoft/vscode) (shallow clones with 300 commits), and, for the contradiction and safety checks, eleven more with no history: Codex, opencode, Vercel's AI SDK, Bun, Astro, Biome, Cloudflare's workers-sdk, Playwright, LangChain, React and Deno.

| Repository | Instruction files | Findings shown                  | Left out as less certain | Time        |
| ---------- | ----------------- | ------------------------------- | ------------------------ | ----------- |
| caveman    | 30                | 4 errors, 74 warnings, 10 notes | 23                       | about 1.0 s |
| Next.js    | 13                | 7 warnings                      | 15                       | about 2.1 s |
| VS Code    | 40                | 4 errors, 26 warnings, 6 notes  | 45                       | about 5.0 s |

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

Contradiction and safety checks:

- The first contradiction check found three pairs in VS Code's instruction files and all three were wrong: a sentence that only describes (`holds the shared ESM options`), a rule for strings that are shown to the user against a rule for all other strings, and `Jest-like snapshot tests` read as a choice of Jest. The check now wants an instruction, skips a rule for one use, and does not read a comparison. See [decision 0007](decisions/0007-contradictions-are-narrow-on-purpose.md).
- A UUID after `token=` (an image link on a documentation site) was read as a secret. A UUID names something and is not one.
- `curl --insecure` was not reported, because the word _insecure_ in the flag was read as a warning against the command. A command's own flags are no longer read.
- A line such as "start it with `--dangerously-skip-permissions` so that it never stops to ask" was not reported, because of the _never_ later in the sentence. A warning now counts when it comes before the command or is a verdict after it.
- The path in a `personal-path` message was cut after 30 characters past the user name.

After those, the contradiction check found nothing in 14 repositories (173 instruction files, 10,543 statements, 43 of them read as one side of a topic), and the safety checks found only the paths below.

To give the secret check more to be wrong about, all 2,476 Markdown and text files of the first three repositories (READMEs, documentation, examples and test fixtures) were also run as if they were instruction files. That found 4 `secret` (below), 13 `risky-command`, 6 `invisible-text`, 1 `prompt-injection` and about 40 `personal-path`, almost all in test fixtures.

**What was checked by hand, and what was not.** Some findings were compared with the source: VS Code's `[index.ts](index.ts)` links point at files that are not in that folder. caveman's instruction files tell the agent to run `make test-browse` in a repository that has never had a Makefile, and caveman's `caveman-compress` folder was renamed while its `CLAUDE.md` kept the old path. VS Code's layout in `ai-customization.instructions.md` lists `aiCustomization.ts` and three more files that are not in that folder. caveman's layout lists `agents/docs/`, which Git shows was deleted. `extension/AGENTS.md` and `extension/CLAUDE.md` really are identical, and `mcp/AGENTS.md` really is part of `mcp/CLAUDE.md`. All of these are real. The other findings, about 120 in total, were **not** read one by one, so some of them may be false positives.

**By hand, in this milestone.** The seven `personal-path` findings in caveman's instruction files are real: its `AGENTS.md` and `CLAUDE.md` send the agent to `/Users/<name>/Desktop/GitHub/...`, a folder on one computer. In the wider run, the four `secret` findings in Next.js examples were read: one was the UUID above, and three are `?secret=` values in the preview links of public demo sites, which are real values and were meant to be shown. The `risky-command` findings were read as commands, and were real: `curl ... | sh` in install instructions, `NODE_TLS_REJECT_UNAUTHORIZED=0` in a CMS example, and a VS Code skill (`.github/skills/azure-pipelines`) that pipes `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash`. The control characters were real: an escape in one of caveman's test fixtures, and a NUL and a SUB in VS Code's. **Not** read: what is around each of those findings beyond the line, and the Markdown files of the wider run that produced nothing. Nothing says that the checks miss little. The tests say what was made, and the real repositories had few real problems of these kinds to find.
