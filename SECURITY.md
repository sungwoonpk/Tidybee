# Security

## Reporting a problem

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: on the repository
page, open the **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it and
what you think the impact is.

This is a personal project, so there is no service level. Reports are read and answered on a best-effort basis, and a
confirmed problem is fixed in `main`. Only the latest `main` is supported.

## What to expect

Tidybee is meant to be run on repositories you did not write, so it is built to only read.

- It does **not** run scripts, install packages or follow commands it finds in a repository.
- The one program it starts is `git`, with fixed arguments and with `core.fsmonitor` turned off. A repository's own Git
  settings can otherwise name a program for Git to run. See [decision 0003](docs/decisions/0003-safe-git.md) for what was
  tried and what is not covered.
- It does not change the repository, including the Git index, and a test checks that.
- It is built not to hang or use up memory on a crafted file: no regular expression is made from what is read, a glob is matched without one, and files are read up to a size limit. This was tried with lines made to make a reader slow, and the ones that were slow are tests. See [decision 0005](docs/decisions/0005-hostile-input-is-bounded.md).
- Text from a repository is written out before the text report prints it, so a file cannot send an escape sequence to your terminal. A finding about a secret shows four characters of it and never the value. See [decision 0006](docs/decisions/0006-safety-findings-never-print-secrets.md).
- It sends nothing anywhere. It does not use the network.
- It has **not had an independent security review**, and it reads untrusted Markdown with a small reader of its own.

If you find a way for a repository to make Tidybee run something, write outside the repository, or hang or crash it, that is
a security problem, and please report it as above.
