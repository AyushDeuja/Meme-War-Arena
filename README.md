# Meme Wars Arena workspace

This is the project starting point for the game described in [idea.md](idea.md),
[requirement.md](requirement.md), and [setup.md](setup.md). The single `Match` PDA holds
two virtual pools and up to ten player slots (five per team).
It is created on Solana, delegated to a MagicBlock Ephemeral Rollup for round
updates, and later committed and undelegated to Solana.

## Current instructions

- `initialize_match`: creates a match and sets each virtual pool to 10,000 credits
  and 1,000 shares.
- `delegate_match`: delegates the match PDA on the base layer. Only its authority
  can sign the delegation instruction.
- `join_match`: grants a wallet 1,000 virtual credits once, for a maximum of ten
  wallets. Run this and other delegated state changes on the ER.
- `choose_team`: lets a registered wallet claim one immutable Frog or Cat slot,
  with five slots per team.
- `start_match`: the match authority starts the 90-second round after both teams
  have at least one player. The program clock sets the deadline.
- `close_match`: any signer can move an expired round to `Finalizing`. Joins and
  team choices are rejected at the deadline or after close.
- `buy_shares` and `sell_shares`: trade Frog or Cat virtual shares on the ER
  during the live round. A registered wallet signs each trade, supplies minimum
  output and its current trade nonce, and receives reserve-backed execution.
- `submit_verified_attempt`: records a score only when the player and the
  approved server verifier sign the same transaction. It enforces three
  attempts, one-use challenge nonces, valid scores, and the program deadline.
- `finalize_match`: after close, computes the immutable skill-score winner.
  Equal team scores use perfect-attempt counts, then Draw. Repeated calls
  preserve the result. The terminal undelegation requires this finalized state.
- `commit_match` and `undelegate_match`: schedule the MagicBlock settlement intent
  from the ER. Commit is allowed while live, finalizing, or finalized; undelegation requires
  finalized status. Confirm base-layer completion separately.

The winner is calculated onchain from verified scores, never market prices.
The frontend displays a separate indicative virtual portfolio leaderboard after
finalization. The organizer can send terminal ER settlement from the Results
page; the proof page shows verified ER and Solana transaction references.

## Frontend

The Next.js app lives in `apps/web`. It uses TypeScript, Tailwind CSS, ESLint,
and the App Router. Its lobby (`/`), arena (`/arena/[id]`), results
(`/results/[id]`), and settlement proof (`/results/[id]/proof`) routes read
real program state. See `apps/web/README.md` for the local two-wallet flow.

```sh
cd apps/web
npm install
npm run dev
npm run lint
npm run build
```

Open <http://localhost:3000> after starting the dev server. Copy
`apps/web/.env.example` to `apps/web/.env.local` when wiring the client. The
sample includes public RPC, router, and program ID values only; do not put
private keys in `NEXT_PUBLIC_` variables.

## Build

Use a compatible Solana/Agave CLI and Anchor 1.0.2 installation. The Rust program
pins `anchor-lang` 1.0.2 and `ephemeral-rollups-sdk` 0.16.2, matching the
maintained Counter / Anchor example. Before connecting to public ERs, verify
compatibility with the selected validator and upgrade to the 0.18 line if
needed. From this directory:

```sh
cargo check -p meme-wars
anchor build --no-idl -- --arch v0
anchor idl build -o target/idl/meme_wars.json -t target/types/meme_wars.ts
```

`Anchor.toml` points to a local validator and the generated program ID. The
development program keypair is at `target/deploy/meme_wars-keypair.json`, ignored
by Git. Back it up privately before deleting `target/`; generating a new keypair
requires updating both `declare_id!` and `Anchor.toml`.

The Phase 0 SBF build and baseline test passed in Ubuntu WSL. Use the pinned
Anchor CLI 1.0.2 there, with the existing Agave CLI and Node 22 from nvm:

```sh
cd '/mnt/c/Users/ayush/OneDrive/Desktop/Meme War Arena'
. ~/.nvm/nvm.sh
nvm use 22.22.3
anchor build --no-idl -- --arch v0
anchor idl build -o target/idl/meme_wars.json -t target/types/meme_wars.ts
anchor test --skip-build
```

The installed SBF platform tools v1.52 require `--arch v0`. Anchor 1.0.2
forwards build arguments to IDL generation, so generate the IDL separately.

Node must be on `PATH` for `anchor test --skip-build` to launch the script in `Anchor.toml`,
even though that script runs Rust tests. See [the Phase 0 baseline](docs/phase-0-baseline.md)
for the exact tested versions and limits of this verification.

For a real ER lifecycle test, initialize and delegate against the base RPC,
query the MagicBlock router's `getDelegationStatus` for the account's ER endpoint,
send round transactions and settlement intents to that ER endpoint, and verify
the committed account on Solana. [The maintained Counter / Anchor example](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/counter/anchor)
is the integration reference. Keep base, router, and ER connections distinct.

## Account boundary

| Account | Creation | Writer | Settlement |
| --- | --- | --- | --- |
| Match PDA (`match`, authority, little-endian match ID) | Base Solana | Program on ER after delegation | Commit and undelegate to base |

The match is 1,086 bytes including the Anchor discriminator, below MagicBlock's
10,240-byte commit limit. The authority funds creation and delegation. The
prototype uses one match at a time; later client code must verify router
placement and wait for delegation and settlement propagation before changing
transaction routing.

The Phase 5 layout adds used challenge nonces and a perfect-attempt count to
every player slot. Use a fresh local ledger when testing this prototype;
accounts created with the earlier 836-byte layout cannot be decoded by the
revised program. Trades spend whole
virtual credits and hold shares in microshares. Buys accept 1–250 credits;
sells accept 1–100 shares (fractional microshares within that range). Pool
rounding preserves the constant-product invariant and may leave dust that
cannot be sold for a whole credit. Prices and portfolio values are indicative
virtual credits only. Trading never changes the battle score or winner.

The server-only timing verifier is in [`verifier/`](verifier/README.md). It
measures press timing, never accepts a browser score, and returns a transaction
partially signed by its own key. The player signs those same transaction bytes
before sending them to the ER. Only the pinned demo organizer may initialize
new matches; its public key is in the program. Keep the verifier keypair outside
the repository and browser environment.

For the Phase 6 two-client chain test, start the documented local MagicBlock
stack, deploy the program, then run `npm run test:phase6:local`. The test uses
two independent wallet providers, trades and scores on ER, finalizes after
the 90-second deadline, and checks the returned Solana account. It also retries
an injected transient **read** failure without sending another settlement
intent. `npm run test:settlement` checks the read-reconciliation helper.
