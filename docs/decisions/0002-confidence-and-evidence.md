# 0002. Every finding carries a confidence, and a missing path is explained by Git

Status: accepted

## Context

A checker that is often wrong gets switched off. The first version of Tidybee, run on real repositories, reported many paths as missing, and a good part of them were not stale: examples such as `path/to/file`, a user's own `settings.json`, a Go `./...` pattern, a file an installer writes into other repositories. Each fix made it better, and no list of fixes would ever be complete.

## Decision

- Every finding has a **severity** (`error`, `warning`, `info`) and a **confidence** (`high`, `medium`, `low`). They are separate: how much it matters is not how sure we are.
- Findings below `medium` are **not shown** unless `--all` is given, and the report says how many were left out, so nothing is hidden silently.
- **Git is the evidence.** A missing path that Git remembers being deleted or renamed is a high-confidence `error`, and the message says in which commit and on what day, and where it went. Without that, a missing path is only a `warning`, or an `info` when even its first folder is not in the repository.
- When something is too ambiguous to report on its own, it is not reported. A bare file name such as `settings.json` is reported only when Git knows a file of that name that is gone.
- A path is read only from code spans and shell blocks, never from running text.
- Examples (`path/to`, `your-app/`, `foo/bar`), wildcards, URLs, absolute and home paths, build output, ignored paths and lines that say a tool writes or installs something are skipped, and each of those rules came from a false positive found on a real repository and has a test.

## Costs

- **Some real stale references are missed:** one written in running text, one in a line that says "writes", or one under a folder that never existed. The cost of a miss is less than the cost of a tool people stop trusting.
- **The skip rules are heuristics.** They are written down in [checks](../checks.md) so that a user can see why something was not reported.
- **Evidence depends on history.** A shallow clone has less, so fewer findings reach `error`.
- **A true statement can still mislead.** Git can say a file was deleted when the instruction file is talking about a file in someone else's repository. The "writes or installs" rule catches the common case and not every one.

## Alternatives considered

- **Report everything and let the user filter.** Easy to build, and it buries the few real problems among many.
- **One severity.** It loses the difference between "certainly broken" and "possibly an example".
