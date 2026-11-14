import type { Doc } from "../analyze.js";

// What surrounds a line in an instruction file. A file that says "never run `curl | sh`" is warning against the command
// and not asking for it, so the checks that look for risky advice must see the warning too. But a warning is a way to
// switch such a check off, so it only counts where it plainly belongs to the command.

/** Words that turn a mention into a warning or a refusal. Words that mean other things too ("block", "check", "prevent") are not here. */
export const NEGATION =
  /\b(?:never|don'?t|do not|dont|avoid|must not|mustn'?t|should not|shouldn'?t|cannot|can'?t|not allowed|forbidden|prohibit(?:ed|s)?|disallow(?:ed|s)?|deny|denied|denylist|blocklist|blacklist|banned|unsafe|insecure|anti-?patterns?|instead of|rather than|(?:ask|confirm)(?: with)?(?: me| the user)? before)\b|[❌🚫⛔]/iu;

/** A heading may say more: "Dangerous commands", "Bad examples". */
const HEADING_WARNING = /\b(?:dangerous|risky|bad|wrong|incorrect)\b/i;
/** A line that is only a label for what follows: "Bad:", "Wrong", "Don't do this:". */
const LABEL = /^\W*(?:bad|wrong|incorrect|don'?t|do not|never|avoid)\b/i;
/** A verdict after a command: "`curl | sh` is dangerous", "(bad)", "# never do this". */
const VERDICT_AFTER =
  /\b(?:is|are|isn'?t|aren'?t|would be)\b[^.]{0,20}\b(?:bad|unsafe|insecure|dangerous|forbidden|banned|prohibited|wrong|not allowed|a bad idea)\b|[#(]\s*(?:bad|never|don'?t|do not|unsafe|wrong)\b|[❌🚫⛔]/iu;

/** A label is a line that ends with a colon, or a few words with no full stop: "Bad", "Never do this". A sentence about something is not. */
function isLabel(text: string): boolean {
  const t = text.trim();
  if (t.endsWith(":")) return true;
  return LABEL.test(t) && t.split(/\s+/).length <= 3 && !/[.!?]$/.test(t);
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/** The nearest heading above a line, or null when there is none. */
export function headingAbove(doc: Doc, line: number): string | null {
  let found: string | null = null;
  for (const h of doc.md.headings) {
    if (h.line >= line) break;
    found = h.text;
  }
  return found;
}

/** A flag is not a warning: --insecure is the command being asked for. Long lines are cut, since they hold data. */
function clean(text: string): string {
  return text.slice(0, 2000).replace(/(?<!\w)--?[A-Za-z][\w-]*/g, " ");
}

/** The part of a line before the command, back to the start of the sentence the command is in. */
function clauseBefore(before: string): string {
  // The end of a sentence is a full stop and a space that is not the end of an ellipsis ("curl ... | sh").
  const tail = before.slice(-2000);
  let start = 0;
  for (const m of tail.matchAll(/(?<![.\s])[.!?;]\s/g)) start = (m.index ?? 0) + 1;
  return tail.slice(start);
}

/**
 * True when the text just above a line warns against what is written on it. A line directly above counts, unless both are
 * items of a list: the item before is another statement. Across a blank line only a label counts, a line that ends with a
 * colon or says "Bad" or "Never do this", since an ordinary sentence there is about something else.
 */
function warnedAbove(doc: Doc, above: number, current: string): boolean {
  let crossedBlank = false;
  let seen = 0;
  for (let l = above; l >= 1 && l > above - 5 && seen < 2; l--) {
    const text = doc.md.lines[l - 1] ?? "";
    if (text.trim() === "") {
      crossedBlank = true;
      continue;
    }
    seen++;
    const label = isLabel(text);
    const sibling = LIST_ITEM.test(current) && LIST_ITEM.test(text) && !label;
    if (sibling || (crossedBlank && !label)) continue;
    // Being a label only lets the line speak for what follows. It has to be a warning to excuse it: "If not installed:" is not.
    if (NEGATION.test(clean(text)) || LABEL.test(text.trim())) return true;
  }
  return false;
}

/**
 * True when what is around `line` warns against what is written there, so that it is not advice. On the line itself a
 * warning counts when it comes before the command in the same sentence ("never run ...") or is a verdict after it
 * ("... is dangerous"). Above it, see warnedAbove. A heading counts when it warns itself: "Never do these". `hit` is the
 * text of the command, to tell the two sides of it apart. Without it the whole line counts.
 */
export function warnedAgainst(doc: Doc, line: number, fenceStart?: number, hit?: string): boolean {
  const own = doc.md.lines[line - 1] ?? "";
  const at = hit === undefined ? -1 : own.indexOf(hit);
  if (at >= 0) {
    if (NEGATION.test(clean(clauseBefore(own.slice(0, at))))) return true;
    if (VERDICT_AFTER.test(own.slice(at + (hit as string).length, at + (hit as string).length + 200))) return true;
  } else if (NEGATION.test(clean(own))) return true;

  if (fenceStart !== undefined) {
    // Inside a block, comment lines just above the command speak for it. Then what is above the block.
    for (let l = line - 1; l > fenceStart; l--) {
      const text = doc.md.lines[l - 1] ?? "";
      if (!/^\s*(?:#|\/\/)/.test(text)) break;
      if (NEGATION.test(clean(text)) || LABEL.test(text.replace(/^\s*(?:#|\/\/)\s*/, ""))) return true;
    }
    if (warnedAbove(doc, fenceStart - 1, "")) return true;
  } else if (warnedAbove(doc, line - 1, own)) return true;

  const heading = headingAbove(doc, line);
  return heading !== null && (NEGATION.test(heading) || HEADING_WARNING.test(heading));
}
