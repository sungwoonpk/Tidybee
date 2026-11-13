# Design decisions

Each record says what was decided, why, and what it costs. Newest last.

| #    | Decision                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0001 | [TypeScript on Node, with no runtime dependencies](0001-typescript-no-dependencies.md)                                                     |
| 0002 | [Every finding carries a confidence, and a missing path is explained by Git](0002-confidence-and-evidence.md)                              |
| 0003 | [Tidybee runs Git safely, because it reads repositories it did not make](0003-safe-git.md)                                                 |
| 0004 | [Quality checks are judgment calls, and say so](0004-quality-checks-are-judgment-and-say-so.md)                                            |
| 0005 | [Hostile input is bounded: no regular expression is built from what is read, and every size has a limit](0005-hostile-input-is-bounded.md) |
