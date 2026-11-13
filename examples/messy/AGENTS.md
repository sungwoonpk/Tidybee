# Invoice service

- Write clean code and follow best practices.
- The service retries a failed payment three times with a growing delay between tries.
- Every public function needs a doc comment that says what it returns and when it fails.
- Configuration is read once at start up from the environment and never from disk afterwards.
- Run `npm test` before every commit, and `npm run build` before every release.
- Keep each payment handler under fifty lines so that it can be read at a glance.
