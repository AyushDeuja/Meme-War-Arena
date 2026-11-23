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
