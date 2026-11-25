# Phase 2: account and integer math decisions

Use one base-created, delegated `Match` account for the fast arena state. Execute writes on its MagicBlock Ephemeral Rollup (ER), then commit and undelegate the final state to Solana. The single writable account preserves the lifecycle proven in Phase 1 and makes competing actions serialize against one canonical record.

## Account and authority model

| Account | Owner and derivation | Authority and funding | Persistence and routing | Settlement |
| --- | --- | --- | --- | --- |
| `Match` | `meme_wars`; PDA `['match', authority pubkey, match_id as little-endian u64]` | Match creator signs initialization and funds rent; creator signs delegation and settlement | Created on base; delegated base copy is owned by the Delegation Program while ER copy remains owned by `meme_wars` | Commit from ER, verify updated base state, then commit-and-undelegate |
| Wallet signer | System account, not game state | Player signs their own join and later trades/attempts | Supplied as an instruction signer; no wallet balance is used as virtual credit | None |
| Verifier signer | Offchain key, public key stored in `Match` | Server controls private key; creator selects public key at initialization | Future score result authorization; no client-supplied score is authoritative | None |

There are no `VirtualPool`, `PlayerPosition`, `Outcome`, token, or ER-only ephemeral accounts in the MVP layout. Both pools, ten player slots, and the outcome live inside `Match`. Every ER instruction that changes this state has one writable game account. The base and ER ownership assertions from Phase 1 remain the routing check. Hosted deployments must additionally use router `getDelegationStatus` to discover the account's ER endpoint; a local RPC address is only for the local stack.

## Exact layout and units

`Match` stores authority (32 bytes), verifier (32), match ID (8), status (1), outcome (1), start/end/finalized timestamps (24), credit reserves (16), share reserves (16), team scores (16), ten `PlayerSlot` values (10 × 60), player count (1), and PDA bump (1). The Borsh payload is **748 bytes**; with the 8-byte Anchor discriminator the allocated account is **756 bytes**. A full ten-player round has the same serialized size because slots are fixed width. This is below the MagicBlock skill's documented 10,240-byte live-validator commit limit; the local test also confirmed this account committed successfully. Changing the layout requires a new account allocation and a fresh local ledger for this prototype.

Each `PlayerSlot` stores wallet (32), whole credits (8), Frog and Cat shares in microshares (8 each), team (1), best verified score (2), and attempts used (1). Slot size is **60 bytes**. Team value `0` means unchosen, `1` Frog, `2` Cat. At most five of the ten wallets may claim each team; Phase 3 enforces this limit. Match status values are `0` Scheduled, `1` Live, `2` Finalizing, `3` Finalized. Outcome values are `0` Pending, `1` Frog, `2` Cat, `3` Draw. The finalized timestamp is zero until finalization. Status and outcome are separate so a closing round can be distinguished from a committed result.

Credits are `u64` whole virtual credits. A wallet starts with 1,000; each pool starts with 10,000. Shares are `u64` microshares (`SHARE_SCALE = 1,000,000`), so each pool starts with 1,000 whole shares or 1,000,000,000 microshares. No field represents a redeemable asset. The creator-supplied verifier pubkey must be nonzero. Future score results must be signed by that verifier and bound to match ID, wallet, ordered attempt number, and challenge nonce; strict attempt-number progression prevents replay within the three-attempt allowance. The browser cannot change the verifier or award scores.

The current initializer accepts any creator and that creator selects the verifier. A client must not treat an arbitrary match as the canonical contest. Before score submission is implemented, Phase 5 must bind the canonical match to an approved organizer/verifier policy onchain; merely checking a signature against a creator-selected key would let that creator attest their own scores. The Phase 2 field is storage for the future authorization rule, not proof that the rule already exists.

## Pool arithmetic and quote policy

The pure Rust functions in `math.rs` specify quotes; no Phase 2 instruction executes a trade. For credit reserve `x`, microshare reserve `y`, and `k = x × y`, use checked `u64` balances and `u128` multiplication/division. Both reserves must stay positive.

- Buy `c` whole credits: `x' = x + c`, `y' = ceil(k / x')`, `microshares_out = y − y'`.
- Sell `q` microshares: `y' = y + q`, `x' = ceil(k / y')`, `credits_out = x − x'`.
- Reject zero input, zero output, empty reserves, or checked overflow. Ceiling the new reserve makes `x' × y' ≥ k`, so rounding cannot lower the invariant. A buy-then-sell round trip cannot increase credits.
- Display spot price only as `floor(x × 1,000,000 × 1,000 / y)` thousandths of a **credit per whole share**. The initial display value is `10.000 credits/share`. It is informational; execution always uses reserves.
- Indicative virtual portfolio value is `available credits + floor(frog_microshares × frog_credit_reserve / frog_microshare_reserve) + floor(cat_microshares × cat_credit_reserve / cat_microshare_reserve)`. This floors each position independently to whole credits. It is a mark at spot prices, not simultaneous realizable liquidation or a financial payout. The battle winner is derived solely from verified team scores, never these prices.

The Phase 4 trade instructions will limit a buy to 1–250 credits and a sell to 1–100 whole shares, reject spending beyond the wallet balance or selling unowned shares, and enforce caller-provided minimum output. A quote is stale whenever an earlier trade changes reserves; the transaction must fail its minimum-output check rather than silently fill at a worse amount. The client then fetches the current account and requests a new quote. One account serializes competing writes, but it also limits throughput; the ten-player cap makes that acceptable for the demo.

## Time, lifecycle, and settlement

The program's `Clock::get()?.unix_timestamp` on ER sets `started_at` when the creator starts a match and `ends_at = started_at + 90` using checked arithmetic. Phase 3 enforces `now < ends_at` for joining and choosing a team during a live round; a browser countdown is advisory. Any signer may close the match at or after the deadline, moving `Live → Finalizing`. Trades and scoring apply the same deadline check. Phase 6 computes the skill-score winner and moves `Finalizing → Finalized`; Phase 8 handles result presentation and portfolio ranking. Unused scoring slots count as zero. When totals tie, the number of perfect attempts breaks the tie; otherwise the result is Draw. No score authority is inferred from trade data.

Initialize and delegate transactions go to base. Join, team choice, start, close, future trades and scoring, commit, and undelegate go to the account's ER. A finalizer sends a terminal commit/undelegate intent and waits for an actual base commitment signature; scheduling an intent alone does not prove settlement. It then reads base account data and verifies program ownership, status, outcome, reserves, and scores. If settlement stalls, keep the match in a pending state and retry/reconcile by signature and account state. Do not create a second match or grant credits again to mask a failed settlement. At most one optional checkpoint commit is planned before terminal undelegation; per-trade commits are unnecessary and would consume the local no-vault commit allowance.

## Phase 3 lifecycle implementation

Registration is open while `Scheduled`, and while `Live` only before `ends_at`. Each wallet can join once and receives exactly 1,000 virtual credits in a fixed player slot. Team selection requires a registered wallet, accepts only Frog or Cat, is immutable once chosen, and caps each roster at five. The authority alone may start a scheduled match, after both teams have at least one member. Anyone may close a live match at its trusted program deadline. In Phase 3, undelegation required `Finalizing`; Phase 6 now requires `Finalized`. Closing alone leaves `outcome` Pending until `finalize_match`. The Phase 3 account layout was 756 bytes including its discriminator.

## Phase 4 trade implementation

The Phase 4 layout appends a `u64 trade_nonce` to each fixed player slot. Slots are now 68 bytes, `Match` payload is 828 bytes, and the allocated account is 836 bytes including its discriminator. Existing 756-byte prototype accounts are incompatible; test with a fresh ledger and do not migrate a live delegated account in place.

`buy_shares(pool, credits_in, min_shares_out, expected_nonce)` and `sell_shares(pool, shares_in, min_credits_out, expected_nonce)` use pool `0` for Frog and `1` for Cat. A registered wallet signs and supplies its current nonce; only successful trades increment it. This stops replay even if the same instruction is resubmitted with a new transaction signature. Both instructions require `Live` and program time before `ends_at`. Team choice is unrelated to trading.

Buys accept 1–250 whole credits and sells accept 1–100 shares in microshare units, allowing fractional shares above the one-share minimum. Minimum output must be positive. The onchain quote uses checked `u128` arithmetic, ceilings the new reserve and rejecting zero output. All new balances and nonce are checked before any state assignment. `requirement.md` now specifies the same ceiling rule for buys and sells: flooring the new reserve could lower `k` and leak value through rounding. Whole-credit settlement can leave unsellable share dust. Trades never update team scores or outcome; spot and portfolio values remain indicative virtual credits.

## Phase 5 scoring implementation

Match initialization now requires the pinned demo organizer public key `7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm`. Only that organizer may select the verifier public key. The verifier's private key remains on the server. `submit_verified_attempt` requires both player and match verifier as Solana transaction signers, with `has_one` binding the latter to the stored key. The server builds and partially signs the exact instruction; the player signs without changing its bytes. Solana transaction signature verification protects the entire message, including match account, wallet, score, attempt, nonce, expiry, and blockhash.

Each player stores three used `u64` challenge nonces and a `u8` perfect-attempt count. Slot size is 93 bytes; `Match` payload is 1,078 bytes and account allocation is 1,086 bytes. Prior layouts are incompatible, so local testing uses a fresh ledger. A valid score is one of 0/30/60/100, and its attempt index must equal `attempts_used + 1` with at most three attempts. The program clock must be before `ends_at` and no later than the signed expiry. Team totals increase only by the improvement over a player's previous best score. Every verified 100-point attempt increments that player's perfect count for the later tie-break phase. Trades and outcome remain unaffected.

The prototype verifier stores short-lived challenges in memory, measures elapsed time on the server, and returns a partially signed transaction. Wallet authentication, token one-use checks, and basic per-IP/per-wallet limits reduce trivial abuse. Automated clients and Sybil wallets can still time presses or coordinate with a compromised verifier. This is not strong anti-cheat. Server restarts invalidate pending challenges but do not change onchain attempts. A verifier-signed transaction that never lands consumes no onchain attempt; a new challenge can be issued while the round remains live.

## Phase 6 finalization and settlement

After the program deadline, anyone may move `Live → Finalizing` and then call `finalize_match`. The program recomputes each team's score from registered players' best verified scores and refuses to finalize if stored totals disagree. It compares those scores, then total perfect attempts, then records Draw if still tied. Reserves and prices are never consulted. The first successful call sets `outcome`, `finalized_at`, and `Finalized`; repeated calls return success without changing any field. The account layout remains 1,086 bytes. The terminal undelegation requires `Finalized`, while a checkpoint commit may still occur during `Live` or `Finalizing`.

The focused two-client ER test uses distinct wallet providers and connections against one delegated `Match` PDA. It checks credit/share conservation and score aggregation after each write, then compares the full finalized ER snapshot to independent base-layer reads after commit and undelegation. The settlement helper retains the ER intent signature, retries commitment lookup and base reads, and never resubmits an intent merely because an RPC read failed. If base state cannot be confirmed, report the intent as pending for later reconciliation. This demo injects a read failure; it does not simulate a real network outage.

## Phase 8 results and browser settlement

The results view reads the program's finalized outcome; it never chooses a skill winner from prices. It displays team scores and perfect-attempt counts, then ranks registered wallets separately by indicative virtual portfolio value. Each holding is valued against the frozen pool reserve ratio with integer arithmetic and floored to whole credits independently, matching the Rust helper. Equal values share a rank; wallet address gives stable display order. This is a mark-to-market competition metric, not a liquidation quote or a payout.

After finalization the organizer may send one terminal `undelegate_match` intent from the Results page. The server captures the program-owned finalized ER account bytes before the intent, then uses `GetCommitmentSignature` to map the confirmed ER intent to its base transaction. A proof receipt is published only if the base transaction succeeded, the base account returned to the Meme Wars program, the match PDA and finalized status are valid, and its account bytes hash exactly matches the captured ER hash. Public receipts live in ignored local server storage; GET rechecks the current base ledger. The signed ER signature is saved in browser storage before broadcast so an uncertain outcome can be reconciled without automatic resubmission. This local receipt store is for the MVP; hosted storage and deployment belong to Phase 9.

## Phase boundaries and validation

Phase 2 changes the account layout, pure math, tests, and this document. It does not implement team selection, trades, scoring, finalization, a web interface, or a verifier service. Unit tests prove exact serialization, full-capacity round-trip, rounding, invariant, zero output, overflow, and no-free-credit round trips. The rebuilt program must repeat the Phase 1 real ER mutation and independent base read on a fresh local stack. The local Agave 4.3.2 stack still needs the documented sBPFv3 deployment feature override for the current legacy Anchor build.
