# 0006. Safety findings never print a secret, and text from a repository is written out before it reaches a terminal

Status: accepted

## Context

The safety checks look for the things that make an instruction file dangerous: a key that was pasted into it, text that a person cannot see and a model can, and advice to run something that should not be run. Three problems come with that.

- **A report that shows the secret leaks it again.** The output of a check goes into a terminal, a CI log, and later code scanning. A log is read by more people and kept longer than the file was.
- **Text from the repository is chosen by the repository's author.** A message that quotes a file passes on whatever is in it. A file with an escape sequence in it can move the cursor, clear the line and print something else, so that a finding looks like nothing, or like another finding.
- **A file that warns against a command is not a file that asks for it.** Instruction files are full of "never run `rm -rf /`" and "do not use `--no-verify`". A check that reports those teaches people to switch the check off.

## Decision

- **A finding shows the first four characters of a secret and its length, never the value.** A test builds each kind of key, checks the finding, and checks that no field of it contains the key or the first twenty characters of it.
- **No test writes a key as a literal.** Each is built when the test runs, from a fixed seed. The repository itself then holds nothing that a secret scanner would stop a push for. The same goes for hidden characters, which are written as `\u{...}` and never as themselves.
- **Keys are judged by their shape first.** A known prefix and length (AWS, GitHub, Anthropic, OpenAI, Slack, Stripe, Google, npm, Hugging Face, SendGrid, two kinds of webhook) is an error with high confidence, unless it is a placeholder: an example, a run of one character, the alphabet in order, or too low in entropy. A private key counts only with its encoded body after the header, since the header alone appears in documentation. A value assigned to a name such as `api_key` or `password` is a warning, and has to look random: a digit and a letter, enough entropy, and not a name, an environment variable, a reference or a UUID.
- **Hidden characters are named by what they do.** Tag characters (which spell text no font draws) are an error, and the finding says what they spell. Soft hyphens, combining grapheme joiners and the Hangul fillers are zero-width, and the Arabic letter mark is a direction control. Zero-width characters are a warning, an error when eight or more are on one line. Direction controls, escape and other control characters, and invisible variation selectors are warnings. What is meant is left alone: the tag letters of the flags of England, Scotland and Wales and only those three (a black flag followed by other tag text is reported), a joiner in an emoji or in a script that uses it, a byte order mark at the start, direction marks, a tab.
- **Risky advice is read only where an agent finds a command**: in code spans, in shell blocks and in HTML comments. A command in a comment is more worrying, since GitHub does not show it, so it is raised a level.
- **A warning is not advice, where it belongs to the command.** On the line itself, a command is excused by a warning before it in the same sentence ("never run ...") or a verdict after it ("... is dangerous"). A line just above counts unless both are items of a list, since the item before is another statement; across a blank line only a label counts (one that ends with a colon, or says "Bad" or "Never do this"). A heading counts when it warns itself ("Never do these", "Dangerous commands"). A command in an HTML comment is never excused. A command's own flags are not read as warnings: `--insecure` is not a verdict. Words that mean other things too ("block", "check", "prevent") are not warnings.
- **Output is written out.** Text output passes the file name, the message and the suggestion through `printable`, which writes every control, direction, zero-width and tag character as `\u{...}`. JSON is data and its string syntax already escapes control characters.

## Costs

- **A real secret that does not look like one is missed.** `password=hunter2` is short and plain, so it is not reported, and a key whose provider has no fixed prefix is only found by its assignment. This is a doctor for instruction files and not a replacement for a secret scanner, and it says so.
- **Entropy limits are chosen,** not derived. They were set on what the real repositories and the tests showed.
- **A warning can still excuse the wrong thing.** A sentence that wraps onto the next line, or a label above a block, is read as speaking for it, so "Never commit secrets." directly above `curl | sh` in the same paragraph excuses it. This was chosen over reporting the warnings, which was worse on real files, and review found that the first, wider version could be switched off by a stray "never".
- **A path with a legitimate zero-width character is shown with an escape in it,** which looks odd. That is the point of the rule.
- **`/home/name/` is only low confidence,** since `/home/` is also a page in a web application.
- **A long line is read whole for secrets, and in windows of 5,000 characters that overlap by 500 for risky commands,** so that padding in front of a command does not hide it. What stops a slow pattern is the limit on every repeated part. Taking those limits away made two of the hostile-input tests fail at about two seconds each, and taking the windows away as well made one not finish in two minutes. See [decision 0005](0005-hostile-input-is-bounded.md).
- **A warning near a command is a way to switch the check off,** so it counts only where it plainly belongs to the command, and never inside an HTML comment, where an attack hides. A file can still excuse a command by writing a warning in front of it, in the same sentence.

## Alternatives considered

- **Printing the secret,** so that it is easy to find. The line number finds it.
- **Masking all but the last four characters.** The last characters of a key are the part that tells apart two keys of one account, and show more than the first four.
- **A secret scanner as a dependency.** It would find more, and Tidybee has no runtime dependencies on purpose. See [decision 0001](0001-typescript-no-dependencies.md).
- **Removing control characters from each message at the check** and not at the output. Every new check would have to remember, and one would not.
- **Dropping unsafe characters instead of writing them out.** Then a finding about a hidden character would not show that it is there.
