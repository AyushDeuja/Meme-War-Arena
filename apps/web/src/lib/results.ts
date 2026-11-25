const U64_MAX = (1n << 64n) - 1n;

export type PortfolioPlayer = {
  wallet: string;
  credits: bigint;
  frogShares: bigint;
  catShares: bigint;
};

function u64(value: bigint) {
  if (value < 0n || value > U64_MAX) throw new Error("Portfolio amount exceeds the onchain range");
  return value;
}

/** Mirrors Rust indicative_portfolio_credits: floor each frozen holding separately. */
export function indicativePortfolioCredits(
  player: PortfolioPlayer,
  creditReserves: readonly [bigint, bigint],
  shareReserves: readonly [bigint, bigint],
) {
  let total = u64(player.credits);
  for (const [index, quantity] of [player.frogShares, player.catShares].entries()) {
    const creditReserve = u64(creditReserves[index]);
    const shareReserve = u64(shareReserves[index]);
    if (creditReserve === 0n || shareReserve === 0n) throw new Error("Final pool reserve is zero");
    total += u64(quantity) * creditReserve / shareReserve;
  }
  return u64(total);
}

export function rankPortfolios(
  players: readonly PortfolioPlayer[],
  creditReserves: readonly [bigint, bigint],
  shareReserves: readonly [bigint, bigint],
) {
  const sorted = players.map((player) => ({
    ...player,
    value: indicativePortfolioCredits(player, creditReserves, shareReserves),
  })).sort((a, b) => a.value === b.value
    ? a.wallet.localeCompare(b.wallet)
    : a.value > b.value ? -1 : 1);
  return sorted.map((player, index) => ({
    ...player,
    rank: index > 0 && sorted[index - 1].value === player.value
      ? sorted.findIndex((candidate) => candidate.value === player.value) + 1
      : index + 1,
  }));
}
