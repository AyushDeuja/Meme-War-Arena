# Meme Wars Arena — Idea & Product Concept

**Version:** 1.0 | **Date:** 2026-11-22 | **Hackathon:** Solana Blitz V10 | **Status:** Proposed MVP

## One-line pitch
A 90-second meme showdown where players compete in verified skill challenges while trading fictional meme shares in a live, fully virtual market powered by MagicBlock Ephemeral Rollups.

**Tagline:** Back your meme. Play the battle. Trade the momentum.

## Problem and opportunity
Memes already inspire online competition, but popularity contests are easily bought or botted. Traditional market simulators also lack real gameplay. Meme Wars combines competitive mini-games with a transparent onchain virtual economy, allowing players to compete as **supporters** (battle points) and **traders** (virtual portfolio performance). No real-money stakes or redeemable prizes are required.

## Who plays
- Crypto-curious gamers who want a short, immediately understandable multiplayer experience.
- Meme communities who want fun head-to-head contests.
- Hackathon judges who can join a room and see a verifiable result within two minutes.

## Player experience
1. Connect a Solana devnet wallet (or enter a spectator view).
2. Join one 90-second arena battle featuring **Frog King** versus **Cat Boss**.
3. Receive **1,000 nontransferable, nonredeemable virtual credits** for that round. Everyone starts with the same allowance.
4. Select a team for skill scoring; choose independently whether to buy or sell either meme's virtual shares.
5. Play a small timing challenge with three attempts. The best validated score counts toward the selected team.
6. Watch charts, two team scores, and your portfolio update as the match proceeds.
7. At the deadline, trading and scoring freeze. The winning meme is the team with the higher **verified, normalized skill score**. Separately, players are ranked by their virtual trading result.
8. The finalized match result is committed to Solana. A badge or nonredeemable achievement can follow if time permits.

## Two distinct leaderboards
### Meme battle winner
Each registered participant gets up to three scored attempts; only the highest legitimate attempt counts. Scoring example: perfect = 100, good = 60, acceptable = 30, miss = 0. For a minimally fair demo, **cap each team's active scoring roster at five unique registered slots** and compute the sum of each roster's best attempts (zero for unused slots). This makes team size and the scoring denominator explicit. One-wallet-one-slot is only a prototype friction measure, **not** real Sybil protection.

Tie-breaking: team with most perfect attempts; if still tied, record a draw. Do not use trading activity or share prices to decide the battle winner. VRF tie-breaks are an optional extension, not required.

### Trading winner
Each account starts with 1,000 virtual credits; it may hold Frog and Cat shares. At cutoff, determine the player's **realizable liquidation value** by hypothetically unwinding their positions against the frozen pools, in a documented fixed order (Frog then Cat) and without changing other players' holdings. This is a **simulation metric**, not a guarantee that all users could cash out simultaneously. Alternatively, for a simpler prototype use mark-to-market equity and label it as *indicative* rather than realizable value. The leaderboard must consistently use one method and display the method to users. No credits, assets, or returns are redeemable for money.

## Virtual market design
Each meme starts with an independent constant-product virtual AMM:
- Initial credit reserve `x = 10,000` and share reserve `y = 1,000`.
- Invariant `k = x*y` (ignoring fees and rounding).
- Spot quotation `P = x/y` **credits per share**; initial spot price is 10 credits/share.
- Buying with `c` credits: `x' = x + c`, `y' = k / x'`, shares received `= y - y'`.
- Selling `q` shares: `y' = y + q`, `x' = k / y'`, credits received `= x - x'`.
- Use checked integer or fixed-point arithmetic onchain; never use float arithmetic for program state.
- Set per-transaction limits and minimum-out slippage guards. Since pools are fictional, no promise of external price discovery.

**Crucial distinction:** A high meme share price is NOT evidence that it deserves the battle win. Price changes through virtual trades; team score changes through validated skill activity. This prevents buying victory outright, though trading manipulation is still possible.

## Entertainment Finance mechanics
- **Allocation:** decide how much of a finite virtual budget to place into each meme.
- **Liquidity and slippage:** large trades move prices more than small trades.
- **Risk management:** selling early, holding, and diversification affect virtual portfolio score.
- **Real-time competition:** live visual reaction to player actions and skill results.

## Why Solana and MagicBlock
- **Solana / Anchor:** define game accounts, trade rules, score validation checks, and final state anchoring.
- **MagicBlock Ephemeral Rollups (ER):** handle frequent game updates and virtual AMM trades at game-like interaction speeds; commit completed state back to Solana.
- **MagicBlock VRF (stretch):** transparent randomness for predeclared mini-game modifiers or deterministic matching; never use random outcomes as a substitute for fair scoring.
- **Private ER:** not required for V10; not necessary when trade and battle data are public.

## Demo narrative (under 2 minutes)
1. Two wallets open the same battle and receive virtual credits.
2. One wallet buys Frog shares; all viewers see Frog's displayed price move.
3. Another sells Cat shares; Cat's price decreases.
4. Each wallet completes a timing challenge; scores change independently of prices.
5. One meme wins despite having a lower closing share price.
6. The results screen distinguishes battle winner from best trader and displays an ER transaction and finalized Solana transaction.

## Differentiation from existing generic meme games
- Real gameplay determines the battle winner, not token wealth or raw wallet votes.
- A real AMM equation powers the fictional market; no arbitrary UI price increments.
- Split competition between team skill and portfolio strategy.
- Solana settlement and ER execution are observable, not simulated blockchain decorations.

## Business hypotheses (post-hackathon; not validated)
- Sponsored community tournaments and creator-branded arenas.
- Custom collectible victory badges and cosmetic avatars.
- Educational mini-games to learn markets and slippage.

These are hypotheses, not evidence of product-market fit. Do not introduce purchasable speculative assets without separate product, legal, and compliance analysis.

## Success criteria
- Two clients view consistent state of the same room.
- A buy increases AMM spot price; a sell decreases it.
- The same skill event cannot be counted twice.
- Price manipulation cannot itself determine battle winner.
- One match completes with a verifiable ER update and Solana settlement.
- Judges understand the two leaderboards in one minute.

## Scope discipline
**Must:** one room at a time, two memes, 90-second round, free credits, AMM trades, timing game, authoritative scoring, live state, ER integration, settlement, final results.

**Stretch:** VRF, onchain collectible mint, multiple rooms, spectators, session keys.

**Out:** real tokens, actual USD, gambling, paid wagers, external token prices, liquidity withdrawal, cash payouts, permissionless user-created memecoins.

## References
- MagicBlock docs: https://docs.magicblock.gg/
- ER SDK: https://github.com/magicblock-labs/ephemeral-rollups-sdk
- Current official integration examples: https://github.com/magicblock-labs/magicblock-engine-examples

## Decisions to revisit
- Exact authority for timing challenge validation (server verifier for prototype, or deterministically verifiable input trace).
- Whether to display mark-to-market or simulated unwind value on the trading leaderboard (choose before implementation).
- Account delegation/commit lifecycle and any cross-account constraints, verified against the current SDK example.
