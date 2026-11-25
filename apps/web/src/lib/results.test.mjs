import test from "node:test";
import assert from "node:assert/strict";
import { indicativePortfolioCredits, rankPortfolios } from "./results.ts";

const initialCredits = [10_000n, 10_000n];
const initialShares = [1_000_000_000n, 1_000_000_000n];

test("whole-credit portfolio math floors each holding independently", () => {
  assert.equal(indicativePortfolioCredits({ wallet: "A", credits: 1_000n, frogShares: 1_000_000n, catShares: 2_000_000n }, initialCredits, initialShares), 1_030n);
  assert.equal(indicativePortfolioCredits({ wallet: "A", credits: 0n, frogShares: 99_999n, catShares: 99_999n }, initialCredits, initialShares), 0n);
  assert.equal(indicativePortfolioCredits({ wallet: "A", credits: 7n, frogShares: 0n, catShares: 0n }, initialCredits, initialShares), 7n);
});

test("ranking gives equal values the same rank and a stable wallet order", () => {
  const rows = rankPortfolios([
    { wallet: "Z", credits: 1_000n, frogShares: 0n, catShares: 0n },
    { wallet: "B", credits: 1_010n, frogShares: 0n, catShares: 0n },
    { wallet: "A", credits: 1_000n, frogShares: 1_000_000n, catShares: 0n },
    { wallet: "C", credits: 900n, frogShares: 0n, catShares: 0n },
  ], initialCredits, initialShares);
  assert.deepEqual(rows.map(({ wallet, rank, value }) => [wallet, rank, value]), [
    ["A", 1, 1_010n], ["B", 1, 1_010n], ["Z", 3, 1_000n], ["C", 4, 900n],
  ]);
});

test("zero reserves and u64 portfolio overflow are rejected", () => {
  const player = { wallet: "A", credits: 0n, frogShares: 0n, catShares: 0n };
  assert.throws(() => indicativePortfolioCredits(player, [0n, 10_000n], initialShares));
  assert.throws(() => indicativePortfolioCredits({ ...player, credits: (1n << 64n) - 1n, frogShares: 1_000_000n }, initialCredits, initialShares));
});
