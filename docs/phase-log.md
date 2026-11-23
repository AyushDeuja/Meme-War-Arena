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
