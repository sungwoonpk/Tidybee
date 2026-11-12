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
- **Coverage gates** are 95% of lines, 95% of functions and 85% of branches. CI fails below them.
- **The examples.** CI builds the command and runs it on `examples/healthy`, which must pass, and `examples/broken`, which must exit with 1 and name its problems.

## Run on real repositories

A check that finds nothing in tests proves little, so Tidybee was run, read only, on three public repositories that have instruction files: [caveman](https://github.com/JuliusBrussee/caveman), [Next.js](https://github.com/vercel/next.js) and [VS Code](https://github.com/microsoft/vscode), each cloned with the last 300 commits.

| Repository | Instruction files | Findings shown        | Left out as less certain | Time        |
| ---------- | ----------------- | --------------------- | ------------------------ | ----------- |
| caveman    | 30                | 3 errors, 60 warnings | 22                       | about 1.3 s |
| Next.js    | 13                | 6 warnings            | 15                       | about 2.0 s |
| VS Code    | 38                | 3 errors, 22 warnings | 44                       | about 4.6 s |

The time includes starting Node. These runs found false positives that the first version had, and each was fixed and given a test:

- A Go pattern `./pkg/...` was read as a path, because the dots were trimmed before it was judged.
- `.md` and `.css` on their own were read as files.
- Bare names such as `settings.json` were reported even though they are usually a user's own file outside the repository.
- `path/to/test.ts` and other example paths were reported.
- A test id `tests/a.py::test_x` was read as one path.
- Lines such as "per-repo `.windsurf/rules/caveman.md` via `--with-init`" were reported as stale, because the installer writes those files into other repositories. They were removed by skipping lines that say a tool writes or installs something.

**What was checked by hand, and what was not.** Three findings were compared with the source: VS Code's `[index.ts](index.ts)` links in `.github/instructions/buildNext.instructions.md` point at files that are not in that folder, which is a real broken link. caveman's instruction files tell the agent to run `make test-browse` in a repository that has never had a Makefile. caveman's `caveman-compress` folder was renamed to `plugins/caveman/skills/caveman-compress`, and its `CLAUDE.md` still names the old path. All three are real. The other findings, about 100 in total, were **not** read one by one, so some of them may be false positives.
