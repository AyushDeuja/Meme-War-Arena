# Development phase log

## Phase 1 — MagicBlock ER lifecycle spike

- Date: 2026-11-22
- Branch/commit before changes: `4e5fba2`
- Files changed: `package.json`, `package-lock.json`, `tests/er-lifecycle.mjs`, `docs/er-spike.md`, `docs/phase-log.md`
- Commands actually run: `npm install`; `anchor deploy --provider.cluster localnet` on Agave 3.1.10 (pass), Agave 4.3.2 with default features (fail), and Agave 4.3.2 with local sBPFv3 deployment feature deactivated (pass); `npm run test:er:local` on Agave 3.1.10 (fail at settlement) and the adjusted Agave 4.3.2 stack (pass); `solana confirm -u http://127.0.0.1:7799 -v <ER transaction signature>` for the failed commit intent and scheduled commit; `solana-test-validator --version` for both versions; `cargo test -p meme-wars --locked` (pass, 2 tests).
- Test results: Rust baseline passed (2 tests). On the final local stack, base initialize, delegation, ER join/update, base commit read, and undelegation passed. The earlier Agave 3.1.10 scheduled commit failed; default Agave 4.3.2 deployment failed until the local feature override was applied.
- Public account and transaction signatures: see `docs/er-spike.md`.
- RPC environment: local MagicBlock stack 1.1.1, base `127.0.0.1:8899`, ER `127.0.0.1:7799`.
- Risks/blockers: The current program binary is legacy sBPF. Deployment to validators enforcing sBPFv3 requires a supported Anchor/SBF rebuild. Local stack reproduction requires Agave 4.3.2 and the documented feature override. `npm install` reported 9 dependency audit findings (2 low, 5 moderate, 2 high); these test dependencies need review before production use.
- Decision: **GO** for Phase 1. A real ER transaction and independent committed base state read were verified. Phase 2 may start in a separate task.

## Phase 2 — state architecture and integer math

- Date: 2026-11-23
- Files changed: `programs/meme_wars/src/lib.rs`, `programs/meme_wars/src/math.rs`, `tests/er-lifecycle.mjs`, `docs/architecture-decisions.md`, `docs/phase-log.md`.
- Commands actually run: `cargo test -p meme-wars --locked` (initial run failed on a zero-output dust resale test; corrected expectation and reran: 7 passed); `anchor build` (passed); `anchor deploy --provider.cluster localnet` on a fresh Agave 4.3.2 MagicBlock stack (passed); `npm run test:er:local` (passed); `cargo fmt --check` (initial formatting check failed), then `cargo fmt` and `cargo fmt --check` (passed); `node --check tests/er-lifecycle.mjs` (passed); `git diff --check` (passed).
- Test results: 748-byte `Match` payload plus 8-byte discriminator confirmed by Rust serialization test and a 756-byte account read on base. Checked math tests covered ceiling rounding, invariant preservation, price/portfolio units, zero output, overflow, and buy-then-sell no-profit behavior. The revised IDL contains `initialize_match(match_id, verifier)` and the new account fields.
- Chain verification: match PDA `AjJSqMG5rR6FDdGAFnFnUsBcTmSar6LP8m4joAdQ1HXs`; base initialize `2GQGr7ECpEeX7Y7Tfj5TDyH3nNYPJMLwjVZLxFMHHMVRvQD16UANUmY3Ne6AjoMF48PLU81fVKVXTqDhpYZnW5q4`; base delegate `3eQLLGSa2UwHLrQ57xw5V1P3NZ1aGoc7AkRvDRwrk8cVwNEdsaFfRDmvT7FvZNrBAY8VaPHGZGJnrcuESBJKW8k8`; ER join `5iH5DL1QA5xQCgezg1BULtBpguA9wzpGjnEUGD2gwk9Bx6YJGM9b3CVPUwnYzHm3tzbF7F1ewdRYS7Vk3KJfdid1`; ER commit intent `25H9Vk1X5rx3zUYtddp14bWur1HCG4rn4qPRHRdkZyxGQcNrKSSthQPuoASNdsiCe2XmeMqMThyjcJJyUF54GRtJ`; base commit `5eqZQqsBGEvDznKqpfV8BoKVS2TgpDkZm2rREki3kbi7dsjRARsLQprgQFhVYoLgkkRGN94JumM8rNLwrBVaEroe`; ER undelegate intent `mKstH1ESzPn96YWFQcWgLMTxnhVWSfGDqCfJVs4bsdGpV3DVGRxfBL8JLPbBdKETcuuDtMrTjM4aLkouHedWmqK`; base undelegate `2N5B8PBowmm6wJydjDKKeBYbUQ3i1M95x9XHy6aTZDevXfousNmJqmmkLLkoj9ANBvxyUmxejutvHdJCVzYpxBGM`.
- RPC environment: local MagicBlock stack 1.1.1, Agave 4.3.2 with the documented local sBPFv3 deployment feature override; base `127.0.0.1:8899`, ER `127.0.0.1:7799`.
- Risks/blockers: math functions are pure and not yet wired into trade instructions; slippage, balance, roster, and replay checks are specified for later phases. The creator currently chooses any nonzero verifier key; canonical organizer/verifier authorization must be enforced before scoring. The legacy sBPF binary still needs a supported toolchain migration for validators enforcing sBPFv3.
- Decision: **GO** for Phase 2. Phase 3 may begin in a separate task.

## Phase 0 — retrospective baseline closure

- Date: 2026-11-23
- Branch/commit before closure: `39d2216`
- Files changed: `docs/phase-0-baseline.md`, `docs/phase-log.md`.
- Commands actually run: WSL `rustc --version`, `cargo --version`, `solana --version`, `anchor --version`, `node --version`, `npm --version` after `nvm use 22.22.3`; `anchor build` (pass); `anchor test` (pass, 7 Rust tests); `git check-ignore .env .env.local target/deploy/meme_wars-keypair.json` (all ignored); tracked key-file name check (no matching tracked files); `git diff --check` (result recorded after writing).
- Test results: current Anchor workspace builds and its configured test suite passes. Two existing Anchor macro `unexpected cfg` warnings remain.
- Chain verification: not part of this retrospective Phase 0 check; real ER/base settlement is recorded in Phases 1 and 2.
- Risks/blockers: baseline checks do not prove devnet deployment or audit file contents for secrets. The current legacy sBPF binary needs the documented local feature override when tested with Agave 4.3.2.
- Decision: **GO** for Phase 0 after the missing baseline document and README link were repaired. Phase 3 may begin in a separate task.

## Phase 3 — match lifecycle, registration, and virtual credit ledger

- Date: 2026-11-23.
- Files changed for this phase: `programs/meme_wars/src/lib.rs`, `tests/er-lifecycle.mjs`, `README.md`, `docs/architecture-decisions.md`, `docs/phase-log.md`. The existing Phase 0 log edit and untracked `docs/phase-0-baseline.md` were preserved.
- Commands actually run: `cargo fmt`; `cargo test -p meme-wars --locked` (initial compile failed because `close` collided with Anchor's account method; renamed to `close_round`, then 11 tests passed); `anchor build` (passed); `anchor deploy --provider.cluster localnet` (passed); `npm run test:er:local` (first run failed on an error-message assertion, second on duplicate transaction signature replay in the test harness, third passed after correcting both); `cargo fmt --check` (passed); `node --check tests/er-lifecycle.mjs` (passed); `git diff --check` (passed); `rg -n 'choose_team|close_match' target/idl/meme_wars.json` (both instructions present). The integration used a fresh local MagicBlock stack 1.1.1 with Agave 4.3.2 and the previously documented local sBPFv3 feature override.
- Test results: 11 Rust tests passed. The real ER script verified duplicate and unregistered joins, one-time 1,000-credit grant, invalid and immutable team choices, five-player team cap, both-team start requirement, authority-only start, exact 90-second deadline, early and duplicate close rejection, late join/team rejection, finalizing-only undelegation, and persistence of eight 1,000-credit player slots after settlement. Re-fetching the account after join demonstrated wallet state persistence independent of a browser session.
- Chain verification: local base `http://127.0.0.1:8899`, ER `http://127.0.0.1:7799`; match PDA `4jdJipHpZGqxfmMNSPVb8pxMNNuyRueLmPHqrovveGfV`; base initialize `4gQk4bgSUpRtTpqYxQugh6Cde71R2EVSjLNNZt95NDCz4dqy5WcncJRsgnBysvY9DHneqQt6mkNmrRzeM1uN795z`; base delegate `28n71pULTHsufY9FruwZmZ4y4xtGhVK6VPKrDJJkQSuxCSxxQxaQufK3wYNWHAshLzJeQSg8pZxtZbDuAnECV8U1`; ER start `tCDvb8tbRqwFNQCK3eJyyu1Pe3G6es5pFy51WEd1qgXwcH4FQy11bPXFT74wBeAht3iYyk8d1SaFqfDYnEmnR5P`; ER close `YR8w1LAjqCSCKD9an4mW5y3iLszwkHJeVQFr3DCq8DoFNaxkvKizV2pDeWizRm3bi8KUfjTypcfoRbb3cFosskG`; base commit `3CKyKP5JgDkaKaBQAu5etyUMC9TacJxHzrUJeCtMuDDtWKCC265P4mEeBusXeNBZjZxgCukH2hPwNytfv38F3ZXs`; base undelegate `3BErwpsZMTogrQjkxZncDAyJCnGv3zupM3PMh9CgN6cPAyaAseoMM1hgWoSJKATukFQbFRKYsQPPyu7uATHS94bK`. Final base account was program-owned and `Finalizing` with pending outcome.
- Risks/blockers: No Phase 4 trade or Phase 5 scoring instructions exist yet, so their deadline checks still need implementation. `Finalizing` keeps a pending outcome until winner finalization in Phase 8. The creator-selected verifier is not yet bound to an approved organizer policy. The legacy SBF build needs the local feature override under Agave 4.3.2; two existing Anchor macro `unexpected cfg` warnings remain. No blocking Phase 3 failure remains.
- Decision: **GO** for Phase 3. Phase 4 may begin only in a separate task.
