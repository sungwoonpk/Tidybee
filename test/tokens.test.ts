import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens } from "../src/tokens.js";

test("empty text costs nothing, and more text costs more", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("   \n\n"), 0);
  assert.ok(estimateTokens("hello world again") > estimateTokens("hello world"));
});

test("long words cost more than short ones, numbers by their digits, marks one each", () => {
  assert.equal(estimateTokens("a"), 1);
  assert.equal(estimateTokens("internationalization"), 3);
  assert.equal(estimateTokens("123456"), 2);
  assert.equal(estimateTokens("!?"), 1);
  assert.equal(estimateTokens("한국어"), 1);
});

// The two paragraphs the caveman project counts with the o200k tokenizer: 63 tokens and 20 tokens. The estimate is not
// that tokenizer, so it is only expected to land near them.
test("the estimate lands near a real tokenizer on ordinary English", () => {
  const long =
    "The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle. When you pass an inline object as a prop, React's shallow comparison sees it as a different object every time, which triggers a re-render. I'd recommend using useMemo to memoize the object.";
  const short = "New object ref each render, so React re-renders. Wrap the prop in `useMemo`.";
  const a = estimateTokens(long);
  const b = estimateTokens(short);
  assert.ok(a >= 63 * 0.85 && a <= 63 * 1.15, `long paragraph: ${a}`);
  assert.ok(b >= 20 * 0.8 && b <= 20 * 1.2, `short paragraph: ${b}`);
  assert.ok(a / b > 2.5, "the shorter text is clearly cheaper");
});
