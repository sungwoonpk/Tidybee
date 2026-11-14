# Limits and roadmap

An honest list of what this version does not do.

- **Only the checks in [checks.md](checks.md) exist.** The rest of the plan below is not built.
- **The contradiction check is narrow.** It knows a short list of topics, reads about 4 statements in a thousand, and has found no real contradiction yet, so how much it misses is not measured. See [decision 0007](decisions/0007-contradictions-are-narrow-on-purpose.md).
- **The safety checks are not a secret scanner.** A key is found by its shape, and a real one without a fixed prefix, or a short plain password, is not. See [decision 0006](decisions/0006-safety-findings-never-print-secrets.md).
- **It finds problems and does not fix them.** There is no `fix`, `sync` or `init` yet.
- **Paths in running text are not checked.** Only code spans and shell blocks are, to keep false positives down.
- **The token count is an estimate** tuned on two paragraphs. Code-heavy text has more tokens than it counts.
- **No configuration.** A finding that is wrong for you cannot be switched off, and the size limits cannot be changed, except that low-confidence findings are hidden unless `--all` is given. There is no `.tidybee.json` and no inline ignore.
- **Git history is limited to 5,000 commits,** and a shallow clone has less, so evidence may be missing.
- **Reviewed on fourteen repositories.** The first three were read closely, and about 100 of their findings were not read one by one. The other eleven were run with the contradiction and safety checks only. See [development](development.md).
- **Not released.** It is not on npm. It runs from a clone.
- **Demo grade.** It has had no independent security review.

## Roadmap

Done: the reference, structure and hygiene checks, the contradiction check and the safety checks.

1. **Output and integration:** SARIF for code scanning, GitHub annotations, a GitHub Action, a pre-commit hook, `.tidybee.json` and inline ignores, a score and a badge.
2. **Fixing:** `fix` for the safe cases, `sync` to keep `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` in step from one source, `init` to write a first instruction file from what the repository has.
3. **Sessions:** a profiler that reads an agent's session logs and says where the tokens went, and `watch`.
