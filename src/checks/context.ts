import type { Doc } from "../analyze.js";

// What surrounds a line in an instruction file. A file that says "never run `curl | sh`" is warning against the command
// and not asking for it, so the checks that look for risky advice must see the warning too.

/** Words that turn a mention into a warning or a refusal: "never", "avoid", "forbidden", "instead of" and the like. */
export const NEGATION =
  /\b(?:never|don'?t|do not|dont|avoid|must not|mustn'?t|should not|shouldn'?t|cannot|can'?t|not allowed|forbidden|prohibit(?:ed|s)?|disallow(?:ed|s)?|deny|denied|denylist|blocklist|blacklist|banned|unsafe|insecure|anti-?patterns?|instead of|rather than|refuse|prevent|block(?:s|ed)?|reject(?:s|ed)?|bad|wrong|(?:ask|confirm|check)(?: with)?(?: me| the user)? before)\b|[❌🚫⛔]/iu;

/** The nearest heading above a line, or null when there is none. */
export function headingAbove(doc: Doc, line: number): string | null {
  let found: string | null = null;
  for (const h of doc.md.headings) {
    if (h.line >= line) break;
    found = h.text;
  }
  return found;
}

/** A verdict after a command: "`curl | sh` is dangerous", "(bad)", "# never do this". */
const VERDICT_AFTER =
  /\b(?:is|are|isn'?t|aren'?t|would be)\b[^.]{0,20}\b(?:bad|unsafe|insecure|dangerous|forbidden|banned|prohibited|wrong|not allowed|a bad idea)\b|[#(]\s*(?:bad|never|don'?t|do not|unsafe|wrong)\b|[❌🚫⛔]/iu;

/**
 * True when the lines around `line` warn against what is written there. On the line itself, a warning counts when it comes
 * before the command ("never run ...") or is a verdict after it ("... is dangerous"), and not a "never" that belongs to
 * another part of the sentence. The two lines before it, the two before the code block it is in, and the heading of its
 * section count whole. `hit` is the text of the command, to tell the two sides of it apart.
 */
export function warnedAgainst(doc: Doc, line: number, fenceStart?: number, hit?: string): boolean {
  // A flag is not a warning: --insecure is the command being asked for. Long lines are cut, since they hold data.
  const clean = (text: string): string => text.slice(0, 2000).replace(/(?<!\w)--?[A-Za-z][\w-]*/g, " ");
  const pick = (l: number): string => clean(doc.md.lines[l - 1] ?? "");
  const own = doc.md.lines[line - 1] ?? "";
  const at = hit === undefined ? -1 : own.indexOf(hit);
  if (at >= 0) {
    if (
      NEGATION.test(clean(own.slice(0, at))) ||
      VERDICT_AFTER.test(own.slice(at + hit!.length, at + hit!.length + 200))
    )
      return true;
  } else if (NEGATION.test(pick(line))) return true;
  const lines = [line - 1, line - 2];
  if (fenceStart !== undefined) lines.push(fenceStart - 1, fenceStart - 2);
  const heading = headingAbove(doc, line);
  return NEGATION.test(`${lines.map(pick).join("\n")}\n${heading ?? ""}`);
}
