export const SHARE_SCALE = 1_000_000n;
const U64_MAX = (1n << 64n) - 1n;

function u64(value: bigint): bigint {
  if (value < 0n || value > U64_MAX) throw new Error("Amount exceeds the onchain range");
  return value;
}

function reserves(credits: bigint, shares: bigint) {
  u64(credits);
  u64(shares);
  if (credits === 0n || shares === 0n) throw new Error("Pool is empty");
  return credits * shares;
}

function ceilDiv(a: bigint, b: bigint) {
  return (a + b - 1n) / b;
}

export function quoteBuy(credits: bigint, shares: bigint, input: bigint) {
  if (input < 1n || input > 250n) throw new Error("Buy 1 to 250 credits");
  const k = reserves(credits, shares);
  const nextCredits = u64(credits + input);
  const nextShares = u64(ceilDiv(k, nextCredits));
  const output = shares - nextShares;
  if (output < 1n) throw new Error("Trade is too small for this pool");
  return { output, nextCredits, nextShares };
}

export function quoteSell(credits: bigint, shares: bigint, input: bigint) {
  if (input < SHARE_SCALE || input > 100n * SHARE_SCALE) throw new Error("Sell 1 to 100 shares");
  const k = reserves(credits, shares);
  const nextShares = u64(shares + input);
  const nextCredits = u64(ceilDiv(k, nextShares));
  const output = credits - nextCredits;
  if (output < 1n) throw new Error("Trade is too small for this pool");
  return { output, nextCredits, nextShares };
}

export function parseShares(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error("Enter up to 6 share decimals");
  const [whole, fraction = ""] = value.split(".");
  return u64(BigInt(whole) * SHARE_SCALE + BigInt(fraction.padEnd(6, "0")));
}

export function minOutput(output: bigint, slippageBps: bigint) {
  if (slippageBps < 0n || slippageBps >= 10_000n) throw new Error("Invalid slippage");
  if (output < 1n) throw new Error("Trade has no output");
  const minimum = output * (10_000n - slippageBps) / 10_000n;
  return minimum > 0n ? minimum : 1n;
}

export function formatShares(value: bigint) {
  const whole = value / SHARE_SCALE;
  const fraction = (value % SHARE_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function spotPrice(credits: bigint, shares: bigint) {
  reserves(credits, shares);
  const milli = credits * SHARE_SCALE * 1000n / shares;
  return `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, "0")}`;
}
