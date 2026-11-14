# 0007. The contradiction check reads a short list of topics, and says nothing about the rest

Status: accepted

## Context

Two rules that say the opposite are worse than one that is wrong, because an agent that reads both follows one of them, and not always the same one. They are also hard to find by reading, since each rule is fine where it stands.

Finding them in general means understanding what a sentence asks for, which Tidybee does not do: it has no language model, no network and no key. A rule-based version that tries to is easy to write, and gives false positives on real files at once.

## Decision

- **The check knows a list of topics and the few ways a rule about each is written:** indentation (tabs or a number of spaces), line length, semicolons, quotation marks, trailing commas, the module system, the test runner, the formatter, committing and pushing, and the package manager. For all other sentences it says nothing.
- **A rule is a statement that tells, not one that describes.** A sentence counts when it starts with an instruction (`use`, `keep`, `indent`, `commit`, `never` and the like) or has a `must` or `should` in it. For line length, the test runner and the formatter a plain statement of fact counts too ("Tests run with Vitest"), since that is often how it is written.
- **A statement with a condition says nothing:** `when`, `if`, `unless`, `except`, `but`, `however`, `only when`. It may be the exception to the other rule. The usual way to say "do not do this by yourself", `unless I ask`, is not a condition for committing and pushing.
- **A rule for part of the work is not a rule against another part.** `for user-visible strings`, `everything else`, `all other files` and `otherwise` mark a statement as partial and it is left out. `for indentation`, `for strings` and `for all code` do not narrow anything.
- **Past and comparison are not rules.** `old`, `previously`, `migrated`, `was`, `ran`, and a name after `like`, `such as`, `similar to`, `instead of`, or written `jest-like`, are not a choice of that tool.
- **Scope keeps statements apart.** A language or a part of the project named in a statement or in its heading (`Python`, `tests`, `frontend`, `packages/app`) puts it in that scope, and a `cd` puts a command in a folder. Two statements are compared only in the same scope. Committing, pushing, the package manager, the test runner and the formatter are about the whole repository, so only a folder keeps them apart.
- **Only files an agent reads together are compared:** the same file, two files that are both read at the start of every session, or two files of one folder. A nested file may change what the root says, and the rules for different files are for different files. The finding is `medium` confidence, and `low` for two files that only share a folder.
- **The package manager is left to the lockfile.** Where one exists, `package-manager` already says which commands are wrong. This check speaks only where no lockfile decides, and counts a statement only when it says to _use_ a manager. `npm publish` and `npm install -g` choose nothing.
- **One finding for each topic and scope,** pointing at the first conflict. Only the first claim of each side in each file is kept, so that a file of a hundred thousand statements is a few comparisons and not billions.

## What it found

On fourteen public repositories (173 instruction files, 10,543 statements) the check read 43 statements as a side of a topic and found **no contradiction**. The first version found three in VS Code's instruction files, and all three were wrong, each now a test:

- A sentence that describes ("`bundle.ts` holds the shared ESM options", "standalone CommonJS preloads") was read as a rule for ES modules and one for CommonJS.
- `"double quotes"` for strings that are shown to the user, and `'single quotes'` for everything else, was read as two rules for one thing.
- "Jest-like snapshot tests" was read as a choice of Jest, against Mocha.

## Costs

- **It misses most things.** It reads 4 statements in a thousand, as sides of the topics it knows. Rules for other topics are not compared, and a rule written as "tabs, not spaces" or in another language than English is not read.
- **Its recall is not measured.** No real contradiction was found to measure it against. The tests show that it finds the ones that were made, and that it leaves alone the near misses that were found.
- **The patterns are English phrases.** A rule worded another way is not seen, on either side.
- **A condition anywhere in a statement removes it,** also when the condition is not about the rule. That is chosen: the check would rather say nothing.
- **Scope words are a list.** A part of the project that is not on it will not keep two statements apart, and the check can then report a pair that is two rules for two parts.

## Alternatives considered

- **A language model to read the rules.** It would need a key and a network, and would answer differently from run to run. See [decision 0004](0004-quality-checks-are-judgment-and-say-so.md).
- **Any "always X" against "never X"** for the same words. It does not need a list, and it finds no synonyms and many false pairs, such as "always run the tests" and "never run the tests in production".
- **Reporting both sides of a pair.** One finding with both places named is enough, and a pair then counts once.
- **A lower bar,** with the false positives hidden behind low confidence. The three above would then have been shown with `--all`, and a contradiction check that is often wrong is one that is switched off.
