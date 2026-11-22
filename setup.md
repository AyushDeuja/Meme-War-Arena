# Meme Wars Arena — Developer Setup & Integration Plan

**Version:** 1.0 | **Date:** 2026-11-22 | **Project:** Solana Blitz V10

> This is a bootstrap and implementation guide, **not a claim that an application or program has already been built**. The precise MagicBlock ER APIs/Anchor compatibility depend on the version actually installed. Begin with the maintained examples and pin tested versions.

## 1. Tech stack
- Frontend: Next.js, React, TypeScript, Tailwind CSS.
- Mini-game: React + browser Canvas or simple DOM timing game; Phaser is optional, not needed for a single timing meter.
- Blockchain: Solana, Rust, Anchor; `@solana/web3.js` or supported newer kit consistently with chosen MagicBlock SDK.
- MagicBlock: Ephemeral Rollups SDK and an ER RPC; VRF optional.
- Backend: small Node.js API for short-lived skill challenges, signed results and rate limits.
- Data: onchain match and player state authoritative; backend is **not** authoritative for currency or match results.

## 2. Operating environment
For Windows development use **WSL2 Ubuntu** for Rust, Solana, Anchor and local validators; use VS Code Remote WSL. A native Windows Node.js setup is possible for frontend work, but blockchain toolchain setup is smoother under Linux.

Install or verify: Git, Node.js (current LTS compatible with chosen examples), package manager (npm or yarn), Rust/rustup, Solana/Agave CLI, Anchor Version Manager (AVM), browser wallet such as Phantom with devnet enabled, and VS Code. Refer to maintained documentation for install commands and versions: https://docs.solana.com/ , https://www.anchor-lang.com/docs/installation , https://docs.magicblock.gg/ .

```bash
node --version
npm --version
rustc --version
cargo --version
solana --version
anchor --version
```

**Version warning:** Official MagicBlock examples have current and `00-LEGACY_EXAMPLES` folders. Avoid pinning the older Anchor 0.32.1 instructions from legacy examples without confirming compatibility. The ER SDK documents different Rust compatibility features for modern Anchor versus older versions.

## 3. Recommended repository structure
```text
meme-wars-arena/
  idea.md
  requirement.md
  setup.md
  apps/
    web/                   # Next.js UI, wallet, lobby, arena, charts
    verifier/              # server-only challenge validation/signing
  programs/
    meme_wars/             # Anchor instructions and account state
  tests/
    amm.spec.ts
    scoring.spec.ts
    settlement.spec.ts
  packages/
    shared/                # types, IDL client, integer AMM math
  scripts/
    devnet-setup.ts
  .env.example
  .gitignore
  Anchor.toml
  Cargo.toml
  package.json
```

## 4. Scaffold locally
Create the frontend and initialize Anchor within a clean workspace. The following commands are **suggested bootstrap steps**; verify CLI options against your installed versions.

```bash
mkdir meme-wars-arena && cd meme-wars-arena
mkdir -p apps packages tests scripts
npx create-next-app@latest apps/web --typescript --tailwind --eslint --app --src-dir
anchor init chain-workspace
```

`anchor init` creates its own directory. Move or keep it as `chain-workspace/` initially; refactor only after the reference ER test succeeds. Do not create a second competing root `Anchor.toml` by accident.

For a quick UI-first start:

```bash
cd apps/web
npm run dev
```

Open http://localhost:3000 . This shows the default Next.js screen until the game UI is implemented.

## 5. Wallet and network
```bash
solana config set --url devnet
solana-keygen new   # skip if you already have a dev wallet; never overwrite your keys
solana address
solana airdrop 1     # may be rate limited; use official faucet if needed
solana balance
```

Use a **dedicated devnet wallet**. Do not expose its mnemonic, JSON keypair or server secrets. Make sure the browser wallet and local `solana config` select the same cluster.

Create an example env file, without real credentials:

```dotenv
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL=REPLACE_WITH_CURRENT_MAGICBLOCK_DEVNET_ER_RPC
NEXT_PUBLIC_PROGRAM_ID=REPLACE_AFTER_DEPLOY
VERIFIER_PRIVATE_KEY=SERVER_ONLY_REPLACE_WITH_SECURE_KEY_REFERENCE
```

**Do not** add a secret to any `NEXT_PUBLIC_` variable. Never check `.env.local` into git. Treat endpoint values as placeholders until confirmed in current MagicBlock docs.

## 6. First technical milestone — prove ER end to end
Before implementing AMM trades or UI chain calls:

```bash
git clone https://github.com/magicblock-labs/magicblock-engine-examples.git
cd magicblock-engine-examples
```

Consult the maintained README and run the current **Counter / Anchor** example; it demonstrates the account lifecycle. The examples repository lists a local validator helper:

```bash
npm install -g @magicblock-labs/ephemeral-validator@latest
```

Inside the chosen example directory, inspect its package scripts and follow its documented commands (commonly `yarn install`, `yarn setup`, `yarn test:local`; scripts are example-specific). Success means you can:
1. Initialize a program account on base Solana.
2. Delegate that account to ER using supported methods.
3. Send an authorized state update to ER.
4. Commit/undelegate as required by the example.
5. Confirm updated final state on Solana and record transaction signatures.

Do **not** assume the endpoint, PDA set, delegation constraints, or commit transaction construction are identical across example versions. Consult https://github.com/magicblock-labs/ephemeral-rollups-sdk and https://docs.magicblock.gg/ .

## 7. Implement onchain gameplay in this order
1. **Round state:** `initialize_match`, `join_match`, `start_match`, `finalize_match`.
2. **Player state:** one credit allocation per match, holdings and optional scoring roster.
3. **Virtual AMM:** `buy_meme`, `sell_meme` with checked integer math, min-output and balance checks.
4. **Skill scoring:** `submit_verified_attempt` with verifier signature validation and replay protection.
5. **Rollup lifecycle:** delegate supported accounts and execute actions on ER, commit final state to Solana.
6. **Optional:** achievement minting after the program works end to end; VRF only if it adds a meaningful game event.

**Important:** updating `Match`, `VirtualPool` and `PlayerPosition` together can require carefully designed account delegation and atomicity. Avoid a rushed schema that breaks ER ownership or cross-account execution. Prototype a single delegated match account with a bounded roster and positions if appropriate; validate sizing and write conflicts before coding the full app.

## 8. Virtual AMM test plan
Use initial reserves `x=10_000`, `y=1_000`, `k=10_000_000` in whole-number examples and production fixed-point units. Write tests for:
- Opening price = 10 credits/share.
- Buy with 500 credits: `x'=10_500`, `y'=k/10_500` (proper fixed-point math), price increases.
- Sell owned shares: new share reserve increases and spot price decreases.
- Selling beyond owned holdings rejects; buying without credits rejects.
- Excessively tiny trades, slippage, overflows, rounding loops, concurrent trades and finalization rejects are covered.

Never calculate onchain money using JavaScript floating-point. Convert input quantities to integer units before constructing instructions; present human-readable decimals only in UI.

## 9. Skill verifier design
A browser alone cannot prove honest timing. Keep a minimal server:
- API requests a short-lived, signed challenge tied to match, wallet and attempt number.
- Server records its own timing windows; browser sends interactions for validation.
- Verifier signs a normalized result with match ID, wallet, nonce, attempt, score and expiry.
- Anchor program verifies the approved verifier key/signature, score range, expiry, and unused nonce; stores best-of-three.

Signature verification implementation depends on Solana instruction sysvar/Ed25519 precompile and transaction structure; do not hardcode an unchecked `score` argument. This verifier is **prototype-grade**, not strong anti-cheat against coordinated bots or modified clients.

## 10. Frontend screens and state
- `/` lobby + rules + wallet.
- `/arena/[id]` character cards, timer, virtual prices, buy/sell form, validation mini-game, live team scores.
- `/results/[id]` winner, draw condition, illustrative portfolio leaderboard, explorer links.

The UI should subscribe to ER account updates or use a supported polling fallback, and always recover state on reconnect. Show `credits/share` everywhere; never use `$` or imply assets have cash redemption.

## 11. Testing checklist
```text
[ ] Wallet connects to devnet
[ ] Two clients join the same match
[ ] Same player cannot claim round credits twice
[ ] Buy/sell follows invariant with checked math
[ ] Invalid/duplicate verifier result is rejected
[ ] Score unaffected by number of shares purchased
[ ] Price leader may lose the battle
[ ] Match finalizes exactly once and rejects late actions
[ ] ER execution and base Solana commitment verified
[ ] Refresh/reconnect doesn't reset balances or attempts
[ ] No sensitive keys in tracked files
```

## 12. Delivery schedule
- **Nov 22:** ER counter spike; lock AMM/scoring spec; scaffold.
- **Nov 23:** AMM and match program tests; build lobby/arena UI.
- **Nov 24:** ER integration milestone; record successful base settlement.
- **Nov 25:** Verifier and live multiplayer UI.
- **Nov 26:** Tests, polish, 90-second demo and submission content.
- **Nov 27:** Submission buffer; verify exact organizer cutoff.

If integration is behind, drop badges and VRF, not the onchain execution proof.

## 13. Helpful official starting points
- MagicBlock docs: https://docs.magicblock.gg/
- MagicBlock ER SDK: https://github.com/magicblock-labs/ephemeral-rollups-sdk
- Maintained MagicBlock ER examples: https://github.com/magicblock-labs/magicblock-engine-examples
- Solana developer docs: https://solana.com/docs
- Anchor docs: https://www.anchor-lang.com/docs

## 14. Current limitations
These docs specify the project; they do not install packages, compile a program, configure a working ER endpoint, deploy a contract, or prove the game is secure. The first implementation task is to follow the maintained example against the chosen toolchain, pin working dependencies, and update this guide with tested versions and commands.
