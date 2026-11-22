# Meme Wars Arena — Development Phases for Codex

**Project:** Solana Blitz V10 · **Start point:** Anchor project already initialized · **Target:** playable, verifiable demo by 2026-11-27  
**Source of truth:** `idea.md`, `requirement.md`, `setup.md`. This plan refines implementation order; it does not imply any code has been implemented.

## Read this first: what we are building

Two teams (**Frog King** and **Cat Boss**) compete in one 90-second room. Each connected wallet may register once and receive **1,000 nonredeemable virtual credits**. Players can trade fictional meme shares in two independent constant-product pools. They choose a scoring team, take up to **three** timing challenge attempts, and only their best *verified* attempt counts. There are at most **five roster slots per team**; empty slots count as zero. The battle winner is the higher verified team score, with perfect-attempt count as first tie-breaker and then a draw. Separately, a **virtual portfolio leaderboard** ranks balances plus holdings marked at closing spot prices (indicative, not guaranteed realizable or redeemable). Game state is executed through a supported **MagicBlock Ephemeral Rollup** and final state is verified on base Solana.

**Non-negotiable:** no real SOL/USDC bets, gambling payouts, mainnet money, fake onchain activity, user-supplied scores, or manually manipulated prices. Display price units as **credits/share**, never USD.

## Architecture boundaries

```text
Two browser clients (Next.js / React)
   | read accounts + submit transactions
   | challenge request / result (separate channel)
   v
Solana Anchor game program <--- approved verifier result authorization
   | init accounts (base chain)
   | delegate supported game state
   v
MagicBlock Ephemeral Rollup (execute trades, scoring, round state)
   | commit / undelegate according to tested SDK flow
   v
Solana base layer (read durable, finalized result)

Verifier API (Node): creates short-lived signed challenges, validates
attempts and signs bounded results. It NEVER manages credits or directly
assigns a battle winner; the onchain program enforces authority and replay.
```

**Important open design decision — state layout:** Choose the PDA/account boundaries **after** reproducing an actual ER delegate → execute → commit → base-chain read lifecycle. A naive `Match` + many player PDAs + two pool PDAs may create unavailable cross-account writes or delegation limitations. Prefer a bounded single-match state if it passes account-size, concurrent-transaction and serialization tests. Document the actual choice in `docs/architecture-decisions.md`.

**Technical prerequisites:** Anchor build and test work locally, Solana CLI configured, repo initialized with git, clean project compiles. Use a Linux/WSL2 development shell if working on Windows.

---

## Phases and stop/go gates

| Phase | Goal | Key deliverable | Gate to proceed |
|---|---|---|---|
| 0 | Audit scaffold | Baseline repo and tests | `anchor build` and baseline tests pass |
| 1 | Prove MagicBlock lifecycle | One delegated counter/update state | Real ER tx and base-chain state read |
| 2 | Freeze game state design | PDA schema and deterministic math | Account sizing + lifecycle unit tests |
| 3 | Implement match lifecycle | Create/join/start/end rules | Invalid lifecycle operations rejected |
| 4 | Implement virtual AMM | Two pools, buy/sell, credit custody | Property and invariant tests pass |
| 5 | Verify skill actions | Challenge service and onchain authorization | Fake/replayed/fourth attempts rejected |
| 6 | Combine ER state execution | Delegated trading/scoring + settlement | End-to-end chain test passes |
| 7 | Implement basic frontend | Wallet, arena, market, timer | Two browsers show same state |
| 8 | Finish round + leaderboards | Winner, score tie-break, portfolio | Correct finalization once only |
| 9 | Harden and rehearse | Error paths, docs, demo | Repeatable end-to-end demo |
| 10 | Optional polish | Badges, VRF, visuals | No regression of required features |

**Do not jump from phase 0 to UI.** Phase 1 is the highest-risk gate. Run an independent verification after each phase. Use one Codex task per phase and commit when green.

---

## Phase 0 — Baseline audit (30–60 minutes)

**Purpose:** Codex must understand the existing Anchor project rather than inventing directories, installing conflicting dependencies, or rewriting project configuration.

**Implementation:**
1. Read `idea.md`, `requirement.md`, `setup.md`, `Anchor.toml`, `Cargo.toml`, `package.json`, `programs/`, and `tests/`.
2. Print version diagnostics: `rustc --version`, `cargo --version`, `solana --version`, `anchor --version`, `node --version`.
3. Record actual program name, ID, cluster, tests, scripts, and any missing files in `docs/phase-0-baseline.md`.
4. Run `anchor build` and existing `anchor test` (or explain the exact blocker). Make no speculative SDK calls.
5. Add `.env.example`, `.gitignore` coverage for keys and target artifacts, and `docs/phase-log.md` only if missing.

**Acceptance:** Existing project compiles and the baseline is reproducible. No secret keys committed.

**Codex prompt:**
> We have an initialized Anchor project for Meme Wars Arena. Read idea.md, requirement.md, setup.md and the actual project files. Work on PHASE 0 ONLY. Audit the repo and tool versions, run the existing build/tests, document exact commands and blockers in docs/phase-0-baseline.md, and make only minimal housekeeping changes. Do not build application features or guess MagicBlock APIs. Return changed files, command results, and the go/no-go assessment.

## Phase 1 — MagicBlock ER vertical slice (highest priority)

**Purpose:** Prove the central hackathon requirement before building the game.

**Implementation:**
1. Use current maintained `magicblock-engine-examples` **Counter / Anchor** and `ephemeral-rollups-sdk` docs; inspect versions and Anchor compatibility. The SDK supports different features for Anchor 1.0 vs older versions. Pin compatible versions only after confirming.
2. Implement or run a minimal account with: base initialization → delegation → ER-only increment/update → commit/undelegate using the supported lifecycle → read the updated account on the base chain.
3. Record addresses, signed transactions, RPC targets, actual SDK methods, all configs, and observed failures in `docs/er-spike.md`. Never place private key bytes in logs.
4. Add a repeatable integration test or script, e.g. `tests/er-lifecycle.spec.ts`, with setup, invocation and final read assertions.
5. Explicitly distinguish **delegated accounts** from **ephemeral-only accounts** (the latter are not durable Solana state).

**Acceptance:** An actual ER transaction changes an account, and the new committed state is independently fetched from base Solana. A normal local-only mock is **not** enough.

**Codex prompt:**
> Execute PHASE 1 ONLY: make the smallest functioning MagicBlock ER integration for our existing Anchor workspace. Consult the official maintained Counter / Anchor example and the exact SDK version used. Prove base initialize, delegate, update on ER, commit/undelegate as appropriate, then read updated state from Solana. Write reproducible test/script and docs/er-spike.md with redacted signatures/endpoints and observed results. Avoid game logic and UI. If the environment cannot run ER, state precisely why; do not mark the phase complete.

## Phase 2 — State architecture and integer math specification

**Purpose:** Prevent account-size, rounding and concurrency failures.

**Implementation:**
1. Write `docs/architecture-decisions.md`: account schema, signer roles, PDA seeds, constraints, data sizes, lifecycle and delegation boundaries. Account models may include `Match`, `VirtualPool`, `PlayerPosition`, and `Outcome`, **but the precise layout is provisional** until ER test confirms multi-account writes.
2. Define fixed-point integer units for credits and shares; use `u64` balances and checked `u128` products/intermediates, explicit floor/ceil rounding. No floats in the program.
3. Model AMM initial reserves separately for Frog and Cat: example `x=10,000 credits`, `y=1,000 shares`; reflect chosen precision consistently. `k = x*y`; spot price `x/y` for display only.
4. Define authoritative time/clock and state transitions; race conditions between competing trades; how client updates resolve stale slippage quotes.
5. Unit-test arithmetic, serialization size, overflow, and the highest expected wallet/roster capacity.

**Acceptance:** All account and math decisions are documented; exact tests for boundary/rounding succeed.

**Codex prompt:**
> Execute PHASE 2 ONLY, based on our proven ER lifecycle and requirement.md. Design the minimum durable game-account schema and deterministic integer math. Explain delegation and multi-account atomicity limitations. Document PDA seeds, account sizes, signer authority, states, time rules, and u64/u128 fixed-point units. Add serialization and math tests. Do not add web UI. If a proposed account layout cannot work with tested ER flow, revise the design instead of pretending it can.

## Phase 3 — Match lifecycle, registration and virtual credit ledger

**Program behavior:**
- `create_match`: fixed `match_id`, two memes, start/end fields, status `Scheduled`.
- `join_match`: exactly once per wallet, capped per-team scoring slots; initial 1,000 virtual credits credited once; wallet identity is **not** unique-human identity.
- `choose_team`: one team, immutable after first scoring attempt (or immediately on joining if simpler and consistent).
- `start_match`: permitted authority and status; 90-second deadline set using trusted program time, not browser time.
- `close/finalizing`: time and lifecycle validation; no trades or attempts beyond deadline.
- Duplicate registrations, reinitialization, unauthorized admin actions, invalid status transitions rejected.

**Acceptance:** Anchor tests show normal lifecycle, wallet reconnect persistence, duplicate-credit rejection, roster cap, and permission checks.

**Codex prompt:**
> Implement PHASE 3 ONLY: the minimal Anchor match lifecycle and wallet registration, following our proven account architecture. Seed exactly 1,000 virtual credits per wallet per match; enforce capped teams, valid state transitions, authority and 90-second duration. Add positive and negative tests (duplicate join, role change, invalid state, wrong signer, replay). Keep everything independent of frontend and do not implement AMM/scoring yet.

## Phase 4 — Two virtual constant-product AMMs

**Program behavior:** Independent pools for Frog and Cat, never real SPL token liquidity. Trades are virtual ledger entries.

For each pool reserve pair `(x credits, y shares)`, use fixed-point checked integers:

- **Buy** `c` credits: `x' = x + c`; `y' = ceil(k/x')` (or a conservatively rounded equivalent, explicitly tested); user receives `y-y'` shares. Compare against `min_shares_out`.
- **Sell** `q` shares: `y' = y + q`; `x' = ceil(k/y')`; user receives `x-x'` credits. Compare against `min_credits_out`.
- No negative balances, zero-reserve pools, overflow, unauthorized position mutations, or trades outside live round. Preserve `x'*y' >= k` as the conservative invariant when rounding up.
- Exact-in amounts, max order sizes, minimum trade size and slippage bounds. Explain any rounding dust.

**Caution:** `requirement.md` illustrates a buy with `floor(k/new_x)`, which can violate the constant-product invariant in integer arithmetic. **Use conservative rounding and update the requirements document with the exact adopted rounding rule before implementing.**

**Tests:** Buy raises spot price, sell lowers it; both pools independent; round-trip trade cannot mint credits; randomized sequences conserve ledger credit/share totals under defined initial supply; zero/tiny trades, large trades, overflow, insufficient balance, stale slippage, selling unowned shares, late trades rejected.

**Acceptance:** Program math is deterministic and property tests pass. No frontend-generated prices.

**Codex prompt:**
> Implement PHASE 4 ONLY. Add two deterministic virtual constant-product pools to our Anchor program. Use checked u128 intermediates and conservative integer rounding with explicit overflow tests. Buy pays credits and receives shares; sell returns owned shares and receives credits. Enforce balance, reserve, amount, slippage and status rules. Add property tests including roundtrip/no-free-credit, independent pools and invariant preservation. First reconcile the rounding example in requirement.md with the implemented rule and document the reason. No UI, no real tokens.

## Phase 5 — Authoritative timing challenge and verified score

**Flow:**
1. Wallet requests challenge from a small **server-only** verifier API; server issues bound `{match_id, wallet, attempt_index, nonce, expiry, challenge_parameters}` and signs or stores it.
2. Browser renders timing interaction; submits bounded input/actions to verifier. **Never trust a browser-submitted numeric score.**
3. Server checks challenge origin, elapsed server-observed time, one-use token, attempt budget, basic rate limits; computes a discrete score `0/30/60/100` and signs a result.
4. Onchain scoring instruction checks **approved verifier authorization**, correct match + wallet + attempt number, expiry, nonce/replay and round status. Implement verifier authorization using a scheme actually supported by Anchor/Solana verification instructions or an authorized verifier signer transaction; do not assume an arbitrary Ed25519 signature is automatically verified in a program.
5. Keep each player's best of 3; count each registered team's five slots (empty slots score zero). Track perfect-attempt *counts* as tie-break defined in requirements. One attempt cannot apply twice.

**Fairness limitation:** Server-observed timing and signature checks reduce trivial forgery but do not guarantee real-world human identity or tamper-proof browser gameplay.

**Acceptance:** Forged score, wrong signer, replayed nonce, fourth attempt, expired challenge, other-wallet challenge, and post-deadline attempt all fail. Rejoining doesn't restore attempts.

**Codex prompt:**
> Execute PHASE 5 ONLY. Add a server-side timing challenge verifier (not in Next.js client bundle), authoritative result checks and onchain best-of-three scoring. Limit scores to 0/30/60/100 and five slots per team. Implement an actual supported Solana verifier-authorization pattern and nonce replay prevention. Document trust limitations. Test valid result, forgery, replay, wrong wallet, expiry, fourth attempt, team score delta and post-deadline rejection. No visual polishing or VRF.

## Phase 6 — Real MagicBlock gameplay execution + durable settlement

**Purpose:** Connect the proven ER lifecycle to *real* trades and verified scoring, not just the counter example.

**Implementation:**
1. Create game accounts on Solana; delegate only the supported, necessary state.
2. Execute at least one buy, one sell and one verified scoring update **on ER** in a two-client test.
3. Ensure reserve, player-position and match-score updates are atomic as required. If not technically possible with current account layout, revise under Phase 2; never split a logical trade into unsafe non-atomic commits.
4. Transition at deadline to a durable finalized outcome; commit and undelegate according to tested SDK flow. Fetch final snapshot from base Solana and compare exact fields to ER state.
5. Handle duplicate finalization and temporary RPC failures idempotently. Preserve transaction references for demo.

**Acceptance:** Repeatable integration test shows both clients, ER trades/scoring, and base-chain final state. Screenshots alone do not count.

**Codex prompt:**
> Execute PHASE 6 ONLY: replace the counter spike with real Meme Wars state updates on MagicBlock ER. Execute real program-backed buy, sell and verified scoring instructions, then commit/undelegate and read exact final state on Solana. Assert atomic ledger consistency. Add end-to-end test with transaction signatures and base-chain account comparisons. If the program state layout conflicts with ER delegation, stop, document and fix architecture; never fake the settlement path.

## Phase 7 — Minimal functional frontend + synchronization

**Pages:** `/` lobby and rules, `/arena/[id]` live room, `/results/[id]` results. Use Next.js, TypeScript, Tailwind; DOM/CSS timing meter is enough (no Phaser needed).

**UI:** Wallet connect, Frog/Cat cards, 90-second countdown based on authoritative end time, remaining credits, holdings, live quoted prices in credits/share, buy/sell forms with slippage display, team choice, 3-attempt skill game, registered team scores, tx status, pending/failed/reconnect states. Spectators can see room but cannot transact.

**Data:** Read canonical program accounts; use subscriptions/polling with reconciliation after reconnect. Optimistic UI must be labeled pending until confirmed. Do not derive an authoritative winner or balance from React state.

**Acceptance:** Two browser windows show the same room and converge after buy/sell/score/refresh. Wrong network and rejected tx show understandable errors.

**Codex prompt:**
> Execute PHASE 7 ONLY: build a simple polished-enough Next.js interface against our tested Anchor/ER client, never mock blockchain values in production code. Add wallet connection, lobby, arena, market, timer, challenge widget, balance and score display with responsive layout. Fetch from authoritative state and resubscribe/reconcile after reconnect. Show loading and transaction errors. Run lint, typecheck and a two-browser smoke test. Do not add NFT, VRF or multiple arenas.

## Phase 8 — Final results and separate leaderboards

**Winner calculation (program authoritative):** Team with higher sum of five registered best scores wins; if equal, compare the number of perfect attempts; if still equal, draw. The final outcome is immutable. A meme's share price **must not decide** the battle winner.

**Portfolio ranking:** `remaining_credits + frog_shares * frog_final_spot + cat_shares * cat_final_spot`, with exact fixed-point rounding. Label **indicative virtual portfolio value** and keep it *separate* from the battle winner. This is **not liquidation value** and may be exploitable as a competition metric through thin-pool mark-up; for the hackathon add clear caveat and transaction-size limits, and do not offer real payouts. Consider simulated liquidation ranking only post-MVP.

**UI:** Results page includes battle score winner, portfolio order, closing prices, final tx IDs and proof link; can display a draw.

**Acceptance:** Tests prove price leader can lose skill battle, equal-score perfect-attempt tie-break, true draw, immutable finalization, no late trades, and correct portfolio rounding.

**Codex prompt:**
> Execute PHASE 8 ONLY: finalize the battle winner independently of market price, with exact 5-slot scores and perfect-attempt tie-break, then draw. Freeze both pools and scoring. Calculate a separate indicative portfolio ranking with documented fixed-point rounding and pricing/manipulation caveat. Build the results page with actual verified final state and ER/base transaction references. Test re-finalization, late actions, ties, draws and price-versus-skill separation.

## Phase 9 — Security, cleanup, deployment, demo

**Tests:** Existing test suite plus end-to-end two-wallet flow; invalid signer, wallet reconnect, lack of credits, late trade, stale quote, fake scores, replay, duplicate finalize, network fault. Confirm no keys in git, browser bundles, screenshots, or CI logs. Recheck RPC and program IDs. Require `anchor build`, `anchor test`, web lint/typecheck/build, verifier tests, ER integration test.

**Demo story (90–120 seconds):** Connect two devnet wallets → join opposite teams → buy Frog to show price increase → sell some Cat to show decrease → complete signed challenges → show battle winner **not necessarily** price leader → settle through ER → display final Solana state and explorer references.

**Artifacts:** Updated README with exact setup, tested versions, environment variables and commands; short demo script; known limitations; deployment URL if available. Record all phases in `docs/phase-log.md`.

**Acceptance:** Another team member can reproduce an end-to-end round on a clean checkout using documented environment prerequisites and observe real tx signatures.

**Codex prompt:**
> Execute PHASE 9 ONLY: audit the finished Meme Wars MVP for security, failures and demo readiness. Run full build/tests/lint/typecheck; execute a fresh two-wallet round through ER settlement; document all results and actual versions. Remove hardcoded keys and false UI claims. Produce README, docs/demo-script.md, docs/known-limitations.md and a final pass/fail checklist. Do not add new game mechanics.

## Phase 10 — Optional enhancements ONLY after phase 9 green

**Priority order:** (1) appealing sprites/charts/sound, (2) devnet collectible victory badge, (3) verifiable random *non-score-changing* arena event, (4) scoped session keys, (5) mobile polish. Never add real-token wagering or cash-out in hackathon MVP. Each optional feature needs a no-regression test and must not break the verified ER lifecycle.

---

## Daily schedule / critical path

| Date | Minimum result required |
|---|---|
| **Nov 22** | Phases 0–1: audit + actual MagicBlock ER vertical slice |
| **Nov 23** | Phases 2–4: state layout, registration, core virtual AMM |
| **Nov 24** | Phases 5–6: score verifier + ER game execution/settlement |
| **Nov 25** | Phases 7–8: UI, two-client sync, final results |
| **Nov 26** | Phase 9: reliability, video, docs and submission rehearsal |
| **Nov 27** | Submission buffer. Verify official deadline/time zone before planning a last-minute deploy |

**If behind:** drop optional badge → VRF → visuals → multiple rooms (never planned) → extra charts. Preserve one playable round, two markets, verified score rules, actual ER lifecycle, durable settlement. If a reliable anti-cheat challenge cannot ship, clearly disclose demo-verifier limitations instead of claiming cheating is impossible.

## How to operate Codex, phase by phase

1. Place this file plus `idea.md`, `requirement.md`, and `setup.md` at repository root. Add `AGENTS.md` from the provided package if desired.
2. **One Codex instruction per phase** (copy the prompt for that phase). Tell Codex to read these files first.
3. Have Codex print **Plan → Files to change → Implementation → Tests run → Results → Remaining risks**. Do not allow it to start the next phase automatically.
4. Manually inspect `git diff`, review security-relevant code, and run the exact reported commands locally. A generated test that was not executed is not a pass.
5. Commit after each passing gate: `git add ... && git commit -m "phase-N: ..."`. Never `git add .` blindly when secrets may be present.
6. When a gate fails, fix the current phase; do not cover missing onchain behavior with a mocked frontend.
7. Maintain a permanent phase log (template below). Do not claim verification without an actual command/output or trace.

### Phase log entry template

```md
## Phase N — title
- Date:
- Branch/commit:
- Files changed:
- Commands actually run:
- Test results (pass/fail/skipped):
- Solana tx signatures / relevant addresses (public only):
- ER tx signatures / RPC environment (public only):
- Risks / blockers:
- Decision: GO / NO-GO
```

## Official references (check current versions)
- MagicBlock docs: https://docs.magicblock.gg/
- Ephemeral Rollups SDK: https://github.com/magicblock-labs/ephemeral-rollups-sdk
- Maintained integration examples: https://github.com/magicblock-labs/magicblock-engine-examples
- MagicBlock development skill for Codex: https://github.com/magicblock-labs/magicblock-dev-skill
- Solana developer docs: https://solana.com/docs
- Anchor docs: https://www.anchor-lang.com/docs

**Final definition of done:** A judge can open the deployed game, see two memes and their virtual markets, witness verified skill attempts and price changes, observe the battle winner independently of price, and inspect proof of the game state's MagicBlock ER execution and final Solana settlement.
