# Meme Wars Arena — MVP Requirements

**Version:** 1.0 | **Date:** 2026-11-22 | **Target:** Solana Blitz V10 demo by 2026-11-27

## 1. Product objective
Deliver a short, playable multiplayer entertainment-finance game in which a meme battle winner is determined by **verified skill results** while fictional share prices are determined independently by **virtual AMM trades**. Demonstrate a working MagicBlock Ephemeral Rollup (ER) lifecycle and final Solana state settlement.

## 2. Assumptions & constraints
- Team: 2–3 developers, roughly five calendar days; scope down if less.
- Solana devnet or reproducible local validator; no mainnet obligations.
- No cash deposits, paid entry, redeemable rewards, investment promises, or real stock/token price feeds.
- One active arena match, two fixed memes, maximum five scoring slots per team, 90-second duration.
- Wallet identity is not person identity. Sybil attacks remain possible; this is a demo, not a production tournament.

## 3. Functional requirements (FR)
| ID | Priority | Requirement | Acceptance test |
|---|---|---|---|
| FR-01 | Must | Connect a Solana wallet or view as spectator | Wallet address shown; spectator cannot submit trades |
| FR-02 | Must | Create/join a battle with Frog King and Cat Boss | Two clients load same ID and state |
| FR-03 | Must | Grant 1,000 virtual round credits once per participant | Rejoining does not reset credits |
| FR-04 | Must | Select one scoring team before first challenge | Team immutable once scoring starts |
| FR-05 | Must | Execute AMM buys and sells for both fictional assets | Reserve invariant holds within integer-rounding tolerance |
| FR-06 | Must | Display price in **credits/share**, reserve-backed trades, and clear change vs opening | Buy increases spot price, sell decreases it |
| FR-07 | Must | Enforce balances, positions, min-output and input caps | Cannot spend more credits or sell unowned shares |
| FR-08 | Must | Show countdown, HP-free timing mini-game, and up to three attempts | Fourth attempt rejected |
| FR-09 | Must | Validate skill results outside untrusted client, apply best-of-three | Forged score payload cannot mint points; replay rejected |
| FR-10 | Must | Derive team score from at most five registered best scores | Team with higher verified total wins |
| FR-11 | Must | Freeze scoring and trading at deadline, resolve tie by perfect attempts else draw | Late transactions rejected based on authoritative time / round status |
| FR-12 | Must | Update connected clients on trades, scores and match state | Both browsers converge after reconnect |
| FR-13 | Must | Delegate relevant game account(s) to MagicBlock ER, execute and commit | ER signature and base-layer result verifiable |
| FR-14 | Must | Display final battle result separately from portfolio leaderboard | Highest closing price alone cannot make winner |
| FR-15 | Must | Recover from refresh or disconnect using chain/authoritative state | No extra credits or attempts after reconnect |
| FR-16 | Should | Create a nonredeemable achievement record or collectible on Solana | Badge references completed round and recipient |
| FR-17 | Could | Use VRF for a preannounced random challenge variation | Proof/outcome traceable; score fairness unchanged |
| FR-18 | Could | Session keys for fewer approval prompts | Session scope and expiry enforced |

## 4. Deterministic market specification
For each meme maintain `credit_reserve`, `share_reserve`, both strictly positive integer fixed-point amounts. Initial example: 10,000 credits and 1,000 shares (units may use fixed precision). `k = x*y`; quoted spot price `x/y`.

**Buy credits-in `c`:** `new_x=x+c`; `new_y=ceil(k/new_x)`; `shares_out=y-new_y`; reject if `shares_out < min_shares_out`, `shares_out=0`, or pool underflows. Rounding the remaining share reserve up preserves `new_x*new_y >= k`; flooring it could lower the invariant and leak value through repeated trades.

**Sell shares-in `q`:** `new_y=y+q`; `new_x=ceil(k/new_y)` when protecting the invariant; `credits_out=x-new_x`; reject if insufficient position or `credits_out < min_credits_out`.

Check that rounding cannot leak value via repetitive tiny transactions; use an explicit invariant check and sufficient precision. **No percentage-based manual price adjustment.** Freeze reserves at end of round; no trades after resolution.

**Financial leaderboard:** For MVP use **indicative mark-to-market** `credits + frog_shares*frog_final_spot + cat_shares*cat_final_spot`; prominently label it *indicative virtual portfolio value* because users could not all liquidate at those spot prices. A simulated actual-unwind ranking is a later improvement. Use exact integer/fixed-point representation and explicit display rounding. No payouts.

## 5. Scoring and fair play
- Participants claim one of five scoring slots per team; unfilled slots score zero.
- Each player gets at most three timing attempts; best result counts: perfect 100 / good 60 / acceptable 30 / miss 0.
- Each attempt has unique `(match_id, player, attempt_number, challenge_nonce)`.
- **Never trust a client-supplied score.** For demo: a dedicated validator service creates signed short-lived challenges; receives inputs/timestamps; evaluates them and signs a result accepted once by the onchain program. Caveat: browser timing can be falsified; service-side timing windows and rate controls only raise the cost of cheating. Production requires stronger attestation/game design.
- The score instruction verifies authorized signer and replay prevention (challenge nonce/sequence) before updating a player's best attempt and team total.
- Higher team sum wins. On equal sums, count perfect attempts; if still equal, draw.
- Wallet cap is not Sybil prevention. For open public tournaments, identity or anti-abuse measures are required.
- Admin cannot silently overwrite outcomes. Any admin intervention is auditable.

## 6. Onchain and ER state (conceptual, validate in integration spike)
- `Match`: match ID, creator/authority, start/end, lifecycle (`Scheduled`, `Live`, `Finalizing`, `Finalized`), chosen team roster, scores, finalized winner.
- `VirtualPool[2]`: meme ID, credit reserve, share reserve, opening and final spot snapshot.
- `PlayerPosition`: wallet, match, available credits, frog/cat shares, team, best score, attempts used, replay-tracking nonce.
- `Outcome`: finalized winner/draw, final reserves/scores, commitment reference.

**Lifecycle:** initialize relevant persistent accounts on Solana -> delegate supported account(s) to ER -> transact on ER -> freeze and commit state -> undelegate if required by selected approach -> read finalized Solana state. Delegation boundaries, PDA sizing, cross-account atomicity, timing and authority must be validated with the current SDK and existing reference tests. **Do not silently assume ephemeral-only accounts persist to Solana.**

## 7. Non-functional requirements
- Responsive desktop first; usable mobile view if time permits.
- Clear loading, transaction pending/failed, and reconnect states.
- Deterministic reproducible tests for AMM math, balance protection, replay, double-grant, score calculation, finalization and rounding.
- No private key in repository, browser bundle or server logs. Server signing key remains backend-only.
- Use verified contract IDs/RPC endpoints; deploy and test on chosen environment.
- Market and leaderboard must not claim actual USD value or guaranteed monetization.

## 8. User interface requirements
- Lobby: join battle, rules, wallet connection.
- Arena: two meme cards, match timer, current scores and score history.
- Market: each spot price, change from opening, trading panel, balances and holdings; label **virtual credits/share**.
- Mini-game: challenge attempts left, feedback and validated score.
- Final screen: battle winner and **separate** indicative portfolio leaderboard, Solana/ER transaction explorer references.

## 9. Security / operational risks
| Risk | Mitigation in MVP |
|---|---|
| Client fakes scores | Signed verifier output + onchain signer/nonce checks; document residual limitations |
| Wash trading and last-second manipulation | Order limits, explicit deadline, wallet rate limit; do not use price to decide battle |
| Sybil accounts and 1,000-credit farming | One entry per wallet per match; fixed five-slot team roster; acknowledge open-wallet weakness |
| AMM rounding exploits | Checked integers, slippage guards, minimum trade size, invariant tests |
| Program/ER account lifecycle errors | Standalone delegation/commit integration test before UI integration |
| Chain interruptions | Idempotent actions, retries and server/client resync, never credit twice |
| Confusing virtual value with cash | Always show 'virtual credits'; no redemption or investment claims |

## 10. Definition of done (hard gates)
1. Two browsers see the same 90-second live battle.
2. A valid buy moves the correct reserve-based spot price up; a valid sell moves it down.
3. Clients cannot mint credits by refreshing or fake score events by arbitrary API calls.
4. The price leader can lose the battle when the opposing team earns more verified points.
5. A finalized match is recorded on Solana through a demonstrated MagicBlock ER workflow.
6. Demo includes a reproducible test or explorer reference for key transactions.

## 11. Schedule and priorities
- **Nov 22:** Agree math/scoring rules, create project skeleton, ER counter proof-of-concept.
- **Nov 23:** Program accounts, round lifecycle, basic UI and trading math.
- **Nov 24:** Complete ER delegation/execution/commit proof; integrate authoritative game state.
- **Nov 25:** Scoring verifier, mini-game, two-client synchronization, tests.
- **Nov 26:** Finalization, demo UX, docs, failure tests, recording.
- **Nov 27:** Fixes and submission buffer; check official deadline/time zone independently.

**Scope cuts if behind:** drop VRF -> drop collectibles -> simplify mini-game visuals -> keep fixed two-wallet scripted demo if public matchmaking fails. Never cut verifiable ER integration or server-authoritative scoring while claiming those features work.

## 12. Links
- https://docs.magicblock.gg/
- https://github.com/magicblock-labs/ephemeral-rollups-sdk
- https://github.com/magicblock-labs/magicblock-engine-examples
