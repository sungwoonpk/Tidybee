# 0001. TypeScript on Node, with no runtime dependencies

Status: accepted

## Context

Tidybee is a command that people run in a repository, mostly people who already use coding agents and so already have Node. It reads Markdown, JSON and Git output and compares them with the file tree. It will often be run on repositories its user did not write.

## Decision

- Write it in **TypeScript for Node 22**, started with `npx` or run from a clone.
- Have **no runtime dependencies**. The Markdown reader, the front-matter reader, the token estimate and the argument handling are small and written here. The only things the program runs are Node itself and `git`.
- Use the same tools as the author's other TypeScript project: ESLint, Prettier, the Node test runner with coverage gates, and CI on two Node versions.
- CI fails the build on any advisory in a runtime dependency and on any high advisory in a development tool, which keeps "no runtime dependencies" true.

## Costs

- **The Markdown reader is not CommonMark.** It knows headings, links, code spans, fenced blocks and imports, and nothing else. An unusual construct can be misread. A full parser would be more exact and would be a dependency that reads untrusted text.
- **The token count is an estimate,** because an exact one needs a tokenizer. It is labeled as one, and tuned on two real counts.
- **It needs Node.** A single static binary would not need that, and is a choice for later if people ask.

## Alternatives considered

- **Go or Rust,** for one binary. The users already have Node, the work is text and JSON, and iterating is faster in TypeScript.
- **A Markdown library such as `remark`.** More exact, and it brings dozens of packages that parse untrusted input into a tool whose point is to be safe to run on other people's repositories.
