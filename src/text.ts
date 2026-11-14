// What a character does to the person or the program that reads it. Text from a repository is chosen by whoever wrote the
// repository, so some of it must be seen for what it is before it is printed, and some of it is a finding in itself.

/** The ways a character can change what is shown, or hide that it is there. */
export type Hidden =
  | "tag" // U+E0000 to U+E007F: spells ASCII text that no font draws
  | "bidi" // overrides and isolates that reorder text
  | "zero-width" // takes no room, so it can split a word or carry bits
  | "joiner" // U+200C and U+200D: zero width, and meant in some scripts and in emoji
  | "variation" // U+E0100 to U+E01EF: invisible selectors that can carry bytes
  | "mark" // direction marks and line separators: meant in some scripts, never printed raw
  | "control"; // escape sequences and other control characters

/** Says how a code point can hide or change text, or null for an ordinary character. Tabs and line breaks are ordinary. */
export function hiddenKind(cp: number): Hidden | null {
  if (cp < 0x20) return cp === 0x09 || cp === 0x0a || cp === 0x0d ? null : "control";
  if (cp < 0x7f) return null;
  if (cp <= 0x9f) return "control";
  if (cp < 0x180e) return null;
  if (cp === 0x180e || cp === 0x200b || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff) return "zero-width";
  if (cp === 0x3164 || cp === 0xffa0 || (cp >= 0xfff9 && cp <= 0xfffb)) return "zero-width";
  if (cp === 0x200c || cp === 0x200d) return "joiner";
  if (cp === 0x200e || cp === 0x200f || cp === 0x2028 || cp === 0x2029) return "mark";
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return "bidi";
  if (cp === 0x206a || cp === 0x206b || cp === 0x206c || cp === 0x206d || cp === 0x206e || cp === 0x206f) return "bidi";
  if (cp >= 0xe0000 && cp <= 0xe007f) return "tag";
  if (cp >= 0xe0100 && cp <= 0xe01ef) return "variation";
  return null;
}

/**
 * Writes text so that it can be printed in a terminal without changing what the terminal shows: every character that
 * hiddenKind knows is written out as \u{...}. A file can hold an escape sequence that moves the cursor or hides what was
 * printed before it, and a message that quotes the file would pass it on.
 */
export function printable(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    out += hiddenKind(cp) === null ? ch : `\\u{${cp.toString(16)}}`;
  }
  return out;
}

/** The ASCII text spelled by a run of tag characters. */
export function decodeTags(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}

/** Shannon entropy in bits for each character. Random keys score high, and words and repeated characters score low. */
export function entropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = [...text].length;
  let bits = 0;
  for (const c of counts.values()) bits -= (c / n) * Math.log2(c / n);
  return bits;
}

/** Cuts text to at most `max` characters, with an ellipsis, so that a long line does not fill a message. */
export function shorten(text: string, max = 80): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}
