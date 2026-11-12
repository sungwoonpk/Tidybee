# Contributing

## Set up

Needs Node 22.13 or newer.

```sh
npm install
npm run check      # lint, format, types, and tests with coverage gates: run this before every push
```

| Command                       | What it does                               |
| ----------------------------- | ------------------------------------------ |
| `npm test`                    | All tests, no coverage                     |
| `npm run test:coverage`       | Tests with line, function and branch gates |
| `npm run lint`                | ESLint                                     |
| `npm run format`              | Prettier, writes changes                   |
| `npm run typecheck`           | TypeScript with no output                  |
| `npm run build`               | Compiles to `dist/`                        |
| `npm run dev -- check <path>` | Runs the command from the sources          |

## How the code is laid out

- `src/checks/` has one function for each group of checks. A check takes the context and returns findings. Add one to the list in `src/engine.ts`.
- `src/markdown.ts`, `src/repo.ts`, `src/project.ts` and `src/git.ts` read things and have no opinions. Put what a check needs to know there, and the judgment in the check.
- Every Git call goes through `src/gitrun.ts`. Do not start a process anywhere else. See [decision 0003](docs/decisions/0003-safe-git.md).
- `src/run.ts` is the command line, with its input and output passed in so that it is tested without a process.

## Making a change

1. Write the test first when you fix a bug, and watch it fail for the reason you expect.
2. **Run a new or changed check on real repositories** before you call it done, and put what you found in the pull request. The tests make small repositories that behave. Real ones are where the false positives are. Every skip rule in [docs/checks.md](docs/checks.md) came from one.
3. When a check can be wrong, give the finding a lower confidence and not a louder message. See [decision 0002](docs/decisions/0002-confidence-and-evidence.md).
4. A new or changed check goes in [docs/checks.md](docs/checks.md), with what it leaves alone.
5. If you change a design decision, write or amend a record in `docs/decisions`. Say what it costs, not only why it is good.
6. Keep the README true. Check each claim you touch against the code.
7. Commit small, with a message that says what changed and why. Everything in the repository is written in English.

## Style

Prettier and ESLint decide formatting and most style questions. Beyond that: prefer a plain function to a class, write a comment for the reason behind something and not for what it does, and when you are unsure whether something is a problem, report it with low confidence or not at all.
