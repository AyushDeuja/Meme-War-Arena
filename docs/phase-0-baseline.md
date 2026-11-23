# Phase 0 baseline — retrospective closure

Checked on 2026-11-23 against the current checkout (`39d2216` before this document). The original Phase 0 build/test was described in `README.md`, but this required record was missing. The commands below were rerun for this closure; their results describe the current Phase 2 program, not a reconstructed historical Phase 0 test run.

## Workspace and versions

The Anchor workspace contains the `meme-wars` Rust crate in `programs/meme_wars`. Its onchain name is `meme_wars`, with program ID `FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs`. `Anchor.toml` selects `localnet`, wallet path `~/.config/solana/id.json`, and a `test` script of `cargo test -p meme-wars --locked`. The program pins `anchor-lang = 1.0.2` and `ephemeral-rollups-sdk = 0.16.2` with its `anchor` feature. Root `package.json` supplies the separate real-ER lifecycle script; the Next.js frontend is in `apps/web`.

Versions printed in WSL Ubuntu after `nvm use 22.22.3`:

| Tool | Observed version |
| --- | --- |
| Rust | `rustc 1.98.1 (48a229cea 2026-09-01)` |
| Cargo | `cargo 1.98.1 (797e8a9bc 2026-08-05)` |
| Solana CLI | `solana-cli 3.1.10 (src:7bc9c805; feat:1620780344, client:Agave)` |
| Anchor CLI | `anchor-cli 1.0.2` |
| Node | `v22.22.3` |
| npm | `10.9.8` |

## Commands and results

From the project root in WSL:

```sh
. /home/ayush/.nvm/nvm.sh
nvm use 22.22.3
rustc --version
cargo --version
solana --version
anchor --version
node --version
npm --version
anchor build
anchor test
```

`anchor build` exited 0 and produced the ignored `target/deploy/meme_wars.so` and `target/idl/meme_wars.json` artifacts. `anchor test` exited 0: the configured Rust test suite ran 7 tests, all passed, with no ignored or failed tests. Rust emitted two existing Anchor macro `unexpected cfg` warnings. This test script verifies Rust code; it does not itself demonstrate an ER transaction or base-layer settlement. The latter was separately verified in Phases 1 and 2, as recorded in `docs/er-spike.md` and `docs/phase-log.md`.

## Repository hygiene and limits

Root `.env.example` contains only RPC/router endpoint settings, with the ER endpoint intentionally blank until delegation routing is known. `.gitignore` covers `/target/`, `/.anchor/`, `/node_modules/`, `.env`, `.env.local`, and log files. `git check-ignore` confirmed `.env`, `.env.local`, and `target/deploy/meme_wars-keypair.json` are ignored. A tracked-file name check found no `id.json`, `*keypair.json`, `.env`, or `.env.local` file. These checks do not audit the contents of every tracked file for secrets.

The current frontend routes are placeholders and no verifier service is implemented; neither is a Phase 0 gate. The current local CLI version builds and tests the legacy sBPF program, while the later MagicBlock settlement test needed Agave 4.3.2 with the documented local sBPFv3 deployment feature override. Do not infer public-cluster compatibility from this baseline.

**Decision: GO for Phase 0.** The current workspace builds, its configured baseline tests pass, and the previously missing baseline record now makes the README link valid.
