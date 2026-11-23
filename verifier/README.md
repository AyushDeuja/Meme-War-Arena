# Server-only timing verifier

This Phase 5 service measures one timing press per challenge. It accepts no
client score or timestamp. It runs outside the Next.js bundle and reads the
canonical match account from `ER_RPC_URL`. Start it from the repository root:

```sh
VERIFIER_KEYPAIR_PATH=/absolute/private/path/verifier.json \
  ER_RPC_URL=http://127.0.0.1:7799 node verifier/server.mjs
```

The keypair file must be outside this repository. Its public key must equal the
verifier selected when the pinned demo organizer creates the match. The server
binds to `127.0.0.1:8787` by default. Set `VERIFIER_PORT` and `ALLOWED_ORIGIN`
for your local setup. Do not put the keypair or its path in `NEXT_PUBLIC_`
variables. The local ER integration test generates a verifier key in memory.

The wallet requests `POST /auth/nonce` with `{match,wallet}`, signs the returned
UTF-8 message, then sends `POST /challenge` with
`{match,wallet,authNonce,signature}`. The service returns a one-use challenge
bound to the match, wallet, attempt index, nonce, expiry, and a 1,500 ms target.
After the press, send `POST /attempt` with `{id,press:true}`. The service uses
its observed elapsed time and scores distance from target: at most 100 ms =
100, 250 ms = 60, 400 ms = 30, otherwise 0. It returns a base64 serialized
transaction already signed by the verifier. The wallet must sign and submit
those same transaction bytes to the ER before expiry; changing any instruction
field invalidates the verifier signature.

Challenges live in memory for up to 30 seconds and are consumed once. A restart
clears pending challenges. Onchain attempt count and nonce history remain the
source of truth, so a new challenge can be requested if a signed transaction
never lands. The server's timing checks do not prove human identity and cannot
prevent a modified browser from automating a press. No real assets or payouts
are involved.
