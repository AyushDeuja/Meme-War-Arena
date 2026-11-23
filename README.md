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
- `commit_match` and `undelegate_match`: schedule the MagicBlock settlement intent
  from the ER. Commit is allowed while live or finalizing; undelegation requires
  finalizing. Confirm base-layer completion separately.

Trading, signed score verification, and winner calculation are future phases.
`Finalizing` still has a pending outcome; this is not yet a playable game.

## Frontend

The Next.js app lives in `apps/web`. It uses TypeScript, Tailwind CSS, ESLint,
and the App Router. Its lobby (`/`), arena (`/arena/[id]`), and results
(`/results/[id]`) routes are placeholders for the game UI; wallet and program
calls have not been connected.

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
anchor build
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
anchor build
anchor test
```

Node must be on `PATH` for `anchor test` to launch the script in `Anchor.toml`,
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

The match is 756 bytes including the Anchor discriminator, below MagicBlock's
10,240-byte commit limit. The authority funds creation and delegation. The
prototype uses one match at a time; later client code must verify router
placement and wait for delegation and settlement propagation before changing
transaction routing.
