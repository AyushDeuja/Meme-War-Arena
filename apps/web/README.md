# Meme Wars Arena frontend

Phase 7 uses the tested **local** Solana + MagicBlock ER stack. It reads the one
match PDA from base Solana to determine delegation, then reads and writes that
match on the ER. Once undelegated, it reads the final account from base Solana.
It never fabricates a market balance, skill score, or winner.

1. Start the local validator and ER as described in the root README. Deploy the
   program with the pinned organizer wallet. Keep private key files outside the repo.
   For the pinned MagicBlock 1.1.1 stack, put the previously tested Agave 4.3.2
   `solana-test-validator` ahead of Agave 3.1.10 on the WSL `PATH`. The 3.1.10
   validator accepts gameplay but rejects MagicBlock settlement transactions
   during deserialization; a successful ER intent alone is not settlement.
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
6. After finalization, the organizer clicks **Settle on Solana** on the Results
   page and approves the terminal ER transaction. The app captures the finalized
   ER account before submission, waits for MagicBlock's base settlement
   signature, and checks the exact final Solana account bytes. The separate
   portfolio ranking and frozen closing prices appear after finalization.
   `/results/<PDA>/proof` shows the ER intent, Solana transaction, and account
   hash once verified. If settlement verification times out, use **Resume
   verification**; do not submit a second intent blindly.

Public proof receipts are stored under `apps/web/.proofs/` and ignored by Git.
The server must have write access to this directory. A fresh local ledger will
invalidate receipts from an older ledger. The receipt is a reference to chain
data; it does not determine the match result. Browser storage retains an
unresolved signed intent signature across refreshes.
For a reusable local check against an already-finalized delegated match, run
`npm run test:phase8:local -- <MATCH_PDA>` from the repository root with the
pinned `ANCHOR_WALLET` and `PROOF_API_URL` set. It submits one terminal intent;
do not rerun it for the same match if confirmation is uncertain.

Only public RPC URLs, program ID, verifier URL and match PDA belong in
`NEXT_PUBLIC_` variables. The verifier key stays server-side. A match address can
also be pasted into the lobby or shared as `/arena/<PDA>`.

Checks: `npm run lint`, `npx tsc --noEmit --incremental false`,
`npm run test:market`, `npm run test:results`, `npm run build`. For live acceptance, use two browser
wallets on the local stack and confirm both windows converge after each action
and refresh. If no local stack is running, the UI shows a connection error; a
static build is not evidence of a successful live transaction.
