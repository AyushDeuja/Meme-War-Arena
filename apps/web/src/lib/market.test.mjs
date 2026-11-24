import assert from "node:assert/strict";
import { test } from "node:test";
import { formatShares, minOutput, parseShares, quoteBuy, quoteSell, spotPrice } from "./market.ts";

test("fixed-point display and conservative rounding match program vectors", () => {
  assert.equal(spotPrice(10_000n, 1_000_000_000n), "10.000");
  assert.equal(parseShares("1.000001"), 1_000_001n);
  assert.equal(formatShares(1_000_001n), "1.000001");
  assert.equal(quoteBuy(10n, 10n, 3n).output, 2n);
  assert.equal(quoteSell(10_000n, 1_000_000_000n, 1_000_000n).output, 9n);
});

test("buy then sell never creates credits", () => {
  for (let input = 1n; input <= 250n; input++) {
    const buy = quoteBuy(10_000n, 1_000_000_000n, input);
    try {
      const sell = quoteSell(buy.nextCredits, buy.nextShares, buy.output);
      assert.ok(sell.output <= input);
      assert.ok(sell.nextCredits * sell.nextShares >= 10_000n * 1_000_000_000n);
    } catch (error) {
      assert.match(String(error), /Sell 1 to 100 shares|Trade is too small/);
    }
  }
});

test("slippage bounds, invalid inputs, and overflow reject safely", () => {
  assert.equal(minOutput(100n, 100n), 99n);
  assert.equal(minOutput(1n, 100n), 1n);
  assert.throws(() => minOutput(100n, 10_000n));
  assert.throws(() => quoteBuy((1n << 64n) - 1n, 10n, 1n), /range/);
  assert.throws(() => quoteSell(10_000n, (1n << 64n) - 1n, 1_000_000n), /range/);
  assert.throws(() => parseShares("1.0000001"));
  assert.throws(() => quoteBuy(10n, 10n, 0n));
});
