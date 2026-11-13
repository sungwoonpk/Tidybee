# Limits and roadmap

An honest list of what this version does not do.

- **Only the checks in [checks.md](checks.md) exist.** Contradictions between rules, secrets and personal paths, and the rest of the plan below are not built.
- **It finds problems and does not fix them.** There is no `fix`, `sync` or `init` yet.
- **Paths in running text are not checked.** Only code spans and shell blocks are, to keep false positives down.
- **The token count is an estimate** tuned on two paragraphs. Code-heavy text has more tokens than it counts.
- **No configuration.** A finding that is wrong for you cannot be switched off, and the size limits cannot be changed, except that low-confidence findings are hidden unless `--all` is given. There is no `.tidybee.json` and no inline ignore.
- **Git history is limited to 5,000 commits,** and a shallow clone has less, so evidence may be missing.
- **Reviewed on three repositories.** About 100 findings were not read one by one. See [development](development.md).
- **Not released.** It is not on npm. It runs from a clone.
- **Demo grade.** It has had no independent security review.

## Roadmap

1. **Contradictions:** rules that say the opposite, two package managers or two styles recommended at once.
2. **Safety checks:** secrets and personal paths in instruction files, invisible text that hides instructions, advice to run `curl | sh` or skip permission prompts.
3. **Output and integration:** SARIF for code scanning, GitHub annotations, a GitHub Action, a pre-commit hook, `.tidybee.json` and inline ignores, a score and a badge.
4. **Fixing:** `fix` for the safe cases, `sync` to keep `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` in step from one source, `init` to write a first instruction file from what the repository has.
5. **Sessions:** a profiler that reads an agent's session logs and says where the tokens went, and `watch`.
