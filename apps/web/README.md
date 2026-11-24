# Meme Wars Arena frontend

Phase 7 uses the tested **local** Solana + MagicBlock ER stack. It reads the one
match PDA from base Solana to determine delegation, then reads and writes that
match on the ER. Once undelegated, it reads the final account from base Solana.
It never fabricates a market balance, skill score, or winner.

1. Start the local validator and ER as described in the root README. Deploy the
   program with the pinned organizer wallet. Keep private key files outside the repo.
2. Start the verifier from the repository root with `VERIFIER_KEYPAIR_PATH` and
   `ER_RPC_URL=http://127.0.0.1:7799`. Its public key must match the one used to
   create the match. The default CORS origin is `http://localhost:3000`.
3. From the root, set `ANCHOR_WALLET` and `VERIFIER_KEYPAIR_PATH`, then run
   `npm run prepare:ui:local`. The script prints the match PDA and base transaction
   signatures. It checks that base delegation and the ER clone are visible.
4. Copy `.env.example` to `apps/web/.env.local`; set `NEXT_PUBLIC_MATCH_PDA` to
   that printed PDA. From `apps/web`, run `npm install` and `npm run dev`. Open
   `http://localhost:3000` using a browser wallet configured for the same local
   validator. Both wallets need local SOL for transaction fees.
5. Join with two wallets, select opposite teams, and start the round with the
   pinned organizer wallet. Trades and timing attempts run on the ER. At the
   deadline, a connected wallet can close and finalize from the Results page.
   Base commit and undelegation follow the tested Phase 6 settlement workflow.

Only public RPC URLs, program ID, verifier URL and match PDA belong in
`NEXT_PUBLIC_` variables. The verifier key stays server-side. A match address can
also be pasted into the lobby or shared as `/arena/<PDA>`.

Checks: `npm run lint`, `npx tsc --noEmit --incremental false`,
`npm run test:market`, `npm run build`. For live acceptance, use two browser
wallets on the local stack and confirm both windows converge after each action
and refresh. If no local stack is running, the UI shows a connection error; a
static build is not evidence of a successful live transaction.
