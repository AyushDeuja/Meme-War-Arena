# Start and demo the frontend from beginning to end

These steps run the current Next.js app against a **local** Solana validator, MagicBlock Ephemeral Rollup (ER), and timing verifier. Use four WSL terminals and two browser profiles with different funded wallets. Leave terminals 1, 3, and 4 running during the round.

## 1. Start the local MagicBlock stack — terminal 1

The tested MagicBlock 1.1.1 stack needs the cached **Agave 4.3.2** validator for settlement. Put its binaries ahead of the WSL `active_release` (which may be 3.1.10):

```bash
export PATH="/home/ayush/.cache/meme-wars-agave-4.3.2/solana-release/bin:/home/ayush/.nvm/versions/node/v22.22.3/bin:/home/ayush/.cargo/bin:$PATH"
solana-test-validator --version
cd "$(mktemp -d /tmp/meme-wars-demo-XXXXXX)"

npx --offline --yes --package=@magicblock-labs/ephemeral-validator@1.1.1 \
  mb-stack --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g
```

Confirm the version command says `4.3.2`. Wait until the stack reports base RPC `http://127.0.0.1:8899`, ER RPC `http://127.0.0.1:7799`, and query service `http://127.0.0.1:6699` ready. Running from a fresh `/tmp` directory keeps the generated `test-ledger/` out of the repository.

## 2. Deploy and prepare one match — terminal 2

```bash
export PATH="/home/ayush/.cache/meme-wars-agave-4.3.2/solana-release/bin:/home/ayush/.nvm/versions/node/v22.22.3/bin:/home/ayush/.cargo/bin:$PATH"
cd "/mnt/c/Users/ayush/OneDrive/Desktop/Meme War Arena"

export ANCHOR_WALLET="$HOME/.config/solana/id.json"
export VERIFIER_KEYPAIR_PATH="$HOME/.config/solana/meme-wars-verifier.json"
test -f "$ANCHOR_WALLET" && test -f "$VERIFIER_KEYPAIR_PATH"
solana-keygen pubkey "$ANCHOR_WALLET"
```

The organizer public key must be `7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm`. Use your actual private-file paths if they differ. The verifier file must be the same one used in terminal 3. Never put either file in the repository or in a `NEXT_PUBLIC_` variable.

The program ID is pinned. Confirm the existing, ignored program keypair resolves to the ID below; **do not generate a replacement keypair** for this project:

```bash
test -f target/deploy/meme_wars-keypair.json
solana-keygen pubkey target/deploy/meme_wars-keypair.json
```

It must print `FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs`. If the file is missing, restore the program keypair from the original setup before deploying.

```bash
test -d node_modules || npm ci
anchor build --no-idl -- --arch v0
anchor idl build -o target/idl/meme_wars.json -t target/types/meme_wars.ts
solana airdrop 10 7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm \
  --url http://127.0.0.1:8899
anchor deploy --provider.cluster localnet
npm run prepare:ui:local
```

The `v0` flag is needed with the installed SBF platform tools v1.52. Build the IDL separately because Anchor 1.0.2 also forwards build arguments to its IDL command, where `--arch` is invalid. The `cdylib`/`lib` LTO warning is informational. Stop if either build command fails; deploying afterward would use an older `target/deploy/meme_wars.so`.

Copy the printed `MATCH_PDA`. The script initializes the account on base Solana, delegates it to the ER, and checks that the ER copy is available. A restarted fresh ledger needs a new deployment and match; an old match address from another ledger will not work.

Fund the second browser wallet using its **public** address:

```bash
solana airdrop 1 SECOND_WALLET_PUBLIC_ADDRESS --url http://127.0.0.1:8899
```

## 3. Start the timing verifier — terminal 3

```bash
cd "/mnt/c/Users/ayush/OneDrive/Desktop/Meme War Arena"
export VERIFIER_KEYPAIR_PATH="$HOME/.config/solana/meme-wars-verifier.json"
export ER_RPC_URL=http://127.0.0.1:7799
export ALLOWED_ORIGIN=http://localhost:3000
node verifier/server.mjs
```

Keep this terminal open. Wait for `Verifier listening on 127.0.0.1`. The verifier must use the **same key file** selected by `prepare:ui:local`. `Start attempt` calls this service at port `8787` before a scoring transaction is sent.

## 4. Configure and start Next.js — terminal 4

Create `apps/web/.env.local` from `apps/web/.env.example` if it does not exist. Set these public values, replacing the PDA with the **new** one from terminal 2:

```dotenv
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL=http://127.0.0.1:7799
NEXT_PUBLIC_VERIFIER_URL=http://127.0.0.1:8787
NEXT_PUBLIC_PROGRAM_ID=FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs
NEXT_PUBLIC_MATCH_PDA=PASTE_NEW_MATCH_PDA
```

`.env.local` takes precedence over `apps/web/.env`. Check it when the lobby shows an old match. For the tested production-server flow, **build after updating the PDA**, then start:

```bash
cd "/mnt/c/Users/ayush/OneDrive/Desktop/Meme War Arena/apps/web"
test -d node_modules || npm ci
npm run build
npm run start
```

The conditional `npm ci` is only needed when dependencies are missing. For development, use `npm run dev` instead of `build` and `start`. Open `http://localhost:3000`. The lobby should show the featured match; the direct room link is `http://localhost:3000/arena/PASTE_NEW_MATCH_PDA`.

## 5. Run the browser demo

Configure both browser wallets for the same local validator. Use one browser profile for the pinned organizer wallet and another profile for the funded second wallet. Open the same arena link in both **before** starting the timer.

1. Organizer: **Join arena** and choose **Frog King**. Second wallet: join and choose **Cat Boss**. Both receive 1,000 virtual credits once.
2. Organizer: click **Start 90-second round**. Both tabs should show `Live` and the countdown.
3. During the round: buy shares with 1–250 credits, then sell at least 1 owned share. Compare credits, holdings, and prices in both tabs.
4. During the round: click **Start attempt**, approve message signing, press **STOP THE METER** near 1.5 seconds, then approve the score transaction. Confirm the team score and attempts left update. Refresh both tabs to check recovery.
5. After the deadline: open **View result**, click **Close expired round**, then **Finalize battle**. Any connected wallet can perform those two actions. The program selects the winner from registered best scores, then perfect-attempt counts, or records a draw.
6. Organizer: on Results, click **Settle on Solana** and approve **once**. Wait for **Verified on Solana**, then open **View proof**. If confirmation remains pending, use **Resume verification** rather than sending another settlement intent.
7. Refresh Results and Proof in both profiles. Confirm the same battle result, closing prices, separate **Indicative virtual portfolio value** ranking, ER intent signature, Solana transaction signature, and matching account hash.

The ranking is virtual mark-to-market value, **not** liquidation value or a payout. Market prices never decide the battle winner.

## 6. If something fails

| Symptom | Check |
| --- | --- |
| **No match loaded** or **Match not found** | Confirm the new PDA in `apps/web/.env.local`, the base RPC, and that Next.js was rebuilt/restarted after editing `NEXT_PUBLIC_MATCH_PDA`. |
| **Connection lost** after **Start attempt** | Confirm terminal 3 is still listening on `127.0.0.1:8787`, the verifier key matches the prepared match, and `ALLOWED_ORIGIN` exactly matches the browser origin (`http://localhost:3000`). Check the browser Network tab for requests to port `8787`. |
| The round expired while fixing a service | Create a fresh match. A completed 90-second round cannot be restarted. |
| Settlement remains pending | Keep the stack running and click **Resume verification**. Do not send a second intent merely because confirmation is slow. |
| Settlement fails inside the local validator | Check `solana-test-validator --version`; Agave 3.1.10 rejected MagicBlock 1.1.1 settlement in this project. Use the tested 4.3.2 path from step 1. |
| A port is already in use | Check `ss -ltnp` in WSL and stop the old instance of that service before starting another. |

Stop the web server, verifier, and stack with Ctrl-C when finished. A new temporary stack may start with a new ledger, so its old match and local proof receipts will no longer verify against that new ledger.
