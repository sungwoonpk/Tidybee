# 0003. Tidybee runs Git safely, because it reads repositories it did not make

Status: accepted

## Context

Tidybee runs `git ls-files`, `git check-ignore` and `git log` in the repository it checks. A repository's own `.git/config` can name a program for Git to run. With `core.fsmonitor`, even a plain `git ls-files`, `git status` or `git check-ignore` runs that program. This was tried: a repository with `core.fsmonitor` set to a command that creates a file created it on each of those three commands.

Someone who points Tidybee at a repository they just cloned, to see whether its instruction files are sound, would have run that repository's code.

## Decision

- All Git calls go through **one function**, `src/gitrun.ts`. Nothing else starts a process.
- It always passes `-c core.fsmonitor=false`, and sets `GIT_OPTIONAL_LOCKS=0` so that a read does not write a lock file or refresh the index.
- Arguments are fixed and given as a list, never built into a shell command, and a path from the user is only ever the `-C` directory.
- If Git fails, Tidybee falls back to walking the folder. Git's own `safe.directory` check, which refuses a repository owned by someone else, therefore makes it fall back and does not bypass it.
- Tests: a repository with a hostile `core.fsmonitor` must not make anything run, and a check must leave the repository, its Git index and any lock file exactly as they were. The first test was shown to fail when the setting is removed.

## Costs

- **Only the setting that was found is turned off.** Other settings may let a repository run programs in some Git versions and commands. The commands Tidybee uses were tried, and `git log` did not run it, but a new Git could add one. The fix is one line in one place.
- **Falling back to a walk** loses `.gitignore` exactness and the history evidence, and the report says so.

## Alternatives considered

- **Not using Git,** and walking the folder only. Safe, and it loses the exact `.gitignore` handling and the best evidence there is.
- **Reading `.git` directly** or using a Git library. More code that parses untrusted data, to avoid one flag.
