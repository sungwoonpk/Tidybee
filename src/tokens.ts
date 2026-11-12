/**
 * An estimate of how many tokens a text costs a model. It is not the count of any one tokenizer: that would need the
 * tokenizer, and Tidybee has no dependencies. It is good for comparing files with each other and for noticing a file that
 * has grown large. It should not be read as a bill.
 *
 * Words cost about one token per five characters, a number about one per three digits, and every other mark costs one.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const m of text.matchAll(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu)) {
    const piece = m[0];
    if (/^\p{L}/u.test(piece)) tokens += Math.max(1, Math.ceil(piece.length / 5));
    else if (/^\p{N}/u.test(piece)) tokens += Math.ceil(piece.length / 3);
    else tokens += 1;
  }
  return tokens;
}
