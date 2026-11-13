# 0004. Quality checks are judgment calls, and say so

Status: accepted

## Context

Most checks answer a question that has an answer: is there such a file, is there such a script. Some useful things to say about an instruction file do not: is it too long, is this sentence filler, are these two files too alike. There is no specification for them, and any limit is chosen.

## Decision

- These checks (`file-size`, `context-budget`, `filler`, `pasted-output`, `todo-marker`, `shouting`, `no-commands`, and the duplication ones) are kept apart from the checks that can be right or wrong, and are documented as judgment.
- They are **notes** by default. Only a very large file that is read every session is a warning.
- Each message says what was measured ("about 6,573 tokens, 539 lines"), not a verdict, so a reader can decide for themselves.
- Thresholds are constants in one place (`src/checks/quality.ts`) with a comment on each, and are listed in [checks](../checks.md).
- `no-commands` has **low confidence**, so it is shown only with `--all`, since a file written only about style is not wrong.
- `filler` never counts a statement that has a code span in it. A statement about something particular is not generic.
- Duplication compares statements and not files, so a copy that has drifted can say which statements are only on one side. Two files are compared only when an agent reads them together or they are in the same folder, and not when one imports the other.

## Costs

- **The numbers are arbitrary.** 2,500 tokens is a note and 5,000 a warning because those felt right on the repositories tried, not because anything says so. A project that wants a bigger file will see the note on every run until there is configuration.
- **`filler` is a list of phrases.** It misses the same advice in other words and can catch a sentence that is meant. It is a note, with the cost of the sentence, and not an accusation.
- **Statements compared as written** do not match a rule worded differently.

## Alternatives considered

- **No checks of this kind.** Then the tool says nothing about the most common way an instruction file gets worse, which is growing.
- **Making them errors,** so that CI fails. A limit that has no basis should not fail a build.
- **A language model to judge quality.** It would need a key and a network, and the answers would change from run to run.
