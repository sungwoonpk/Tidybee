# 0005. Hostile input is bounded: no regular expression is built from what is read, and every size has a limit

Status: accepted

## Context

Tidybee is meant to be run on repositories its user did not write. The Markdown it reads, the globs in a rule file and the paths of the repository are all chosen by the author of that repository. A tool that can be made to hang by a crafted file is a tool that is unsafe to point at one.

This was tried and not assumed. Lines of 60,000 characters were fed to each reader. A heading made of a few characters and 60,000 spaces ran for more than eight seconds, a glob with a few dozen `**` against a deep path never finished, and a line of brackets and parentheses took nearly a second. All were regular expressions that backtrack.

## Decision

- **No regular expression is built at run time from text that was read.** A code block's closing line, a header key and a glob are matched with plain code.
- **A glob is matched without a regular expression.** Braces are written out (at most 64 choices), a pattern is matched path segment by path segment by dynamic programming, and inside a segment `*` is a greedy walk. Several `**` in a row are one. A glob longer than 300 characters, or with more than 64 choices, is _not judged_, and a caller is told so with `undefined` or `-1` instead of "matches nothing".
- **The static regular expressions have limits on every repeated part.** A heading is read by hand, and a link's text, target and title have an upper size.
- **Sizes are limited.** An instruction file is read up to 2 MB and the report says when it was cut. Other files are read up to 5 MB. At most 500 instruction files are checked, and the report says how many were left.
- **The inputs that were slow are tests,** in `test/robustness.test.ts` and `test/glob.test.ts`, each with a time limit. Each was shown to fail when its protection is taken away: the old heading regular expression hangs, and removing the bound on a link's target makes the test take over three seconds instead of a fifth of one.

## Costs

- **A glob is matched by code that is not a regular expression,** so there is more of it to get right. It has its own tests for the same cases, and the two that decide how it is read (`**` and braces) have extra ones.
- **A link target over 2,000 characters, or a link text over 500, is not read as a link.** Real ones are far shorter, and a test checks that an ordinary long one still works.
- **A file past 2 MB is only partly checked,** and 500 is a limit on files. Both are said in the report, not hidden. Neither is configurable yet.
- **A test that checks for a hang is a test that hangs.** Node's test runner cannot interrupt code that never returns, so a regression would show up as a slow or killed CI job, and not as a clean failure. Each test also checks its own time so that a slowdown short of a hang is a failure.
- **Not everything is proved.** The static regular expressions that were not slow were tried on inputs made to make them slow and were not changed. A new one could still be written badly. The contributing guide asks that each new reader gets a hostile-input test.

## Alternatives considered

- **A regular expression engine with guaranteed linear time** (RE2). It would remove the problem for all patterns, and it is a native dependency, which Tidybee does not have.
- **A time limit around each check** with a worker thread. It catches anything, and it makes the tool slower, more complicated and its answers partial without saying where.
- **Leaving it,** because a user who runs the tool on a hostile repository gets a hang and not a compromise. A hang on a continuous integration server is still a denial of service, and the fix was cheap.
