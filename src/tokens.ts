/**
 * An estimate of how many tokens a text costs a model. It is not the count of any one tokenizer: that would need the
 * tokenizer, and Tidybee has no dependencies. It is good for comparing files with each other and for noticing a file that
 * has grown large. It should not be read as a bill.
 *
 * A word of up to nine letters costs one token and a longer one a token for every nine letters, a number costs one token
 * for every three digits, and every other mark costs half a token, since marks often join the token next to them. It was
 * tuned on two English paragraphs that the o200k tokenizer counts at 63 and 20 tokens, where it gives 63 and 17. Text
 * made mostly of code, paths and identifiers has more tokens than this counts.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const m of text.matchAll(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu)) {
    const piece = m[0];
    if (/^\p{L}/u.test(piece)) tokens += Math.max(1, Math.ceil(piece.length / 9));
    else if (/^\p{N}/u.test(piece)) tokens += Math.ceil(piece.length / 3);
    else tokens += 0.5;
  }
  return Math.round(tokens);
}
