# Phase 1: MagicBlock ER lifecycle spike

Date: 2026-11-22. Status: **GO**. A real local Ephemeral Rollup update was committed to the base validator and independently read there. Undelegation also succeeded.

## Setup and versions

- Program: `meme_wars`, `FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs`.
- Anchor CLI 1.0.2, Anchor Rust and JS 1.0.2 / 0.32.1 respectively; Rust `ephemeral-rollups-sdk` 0.16.2; JS SDK 0.18.0.
- MagicBlock local stack: `@magicblock-labs/ephemeral-validator@1.1.1` (`mb-stack`). Base RPC `http://127.0.0.1:8899`; ER RPC `http://127.0.0.1:7799`; public query filtering RPC `http://127.0.0.1:6699`.
- First base validator: Agave 3.1.10 (commit failed). Working base validator: Agave 4.3.2 with the local sBPFv3 deployment feature deactivated so the existing Anchor 1.0.2 program binary could deploy. Both used the same MagicBlock stack package.
- Local validator identity used for delegation: `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`.
- Maintained reference: [MagicBlock Counter / Anchor example](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/Counter/Anchor) and [MagicBlock validator local stack](https://github.com/magicblock-labs/magicblock-validator). The Rust SDK version matches the inspected Counter example.

The `Match` PDA uses `match`, authority pubkey, and a little endian `u64` match ID. It is a **delegated base account**: created on base, temporarily owned by the delegation program there, mutated on ER, and expected to return to base with committed state. No ephemeral-only account is used; an ephemeral-only account would not itself be durable Solana state.

## Reproduce

In WSL Ubuntu, with Node 22.22.3 and Agave 4.3.2 `solana-test-validator` and `solana` on `PATH`, install dependencies from the project root. Start the stack in a Linux filesystem directory (the Windows-mounted workspace caused a Unix admin-socket startup error):

```sh
npm install
mkdir -p /tmp/meme-wars-er-phase1
cd /tmp/meme-wars-er-phase1
npx --yes --package=@magicblock-labs/ephemeral-validator@1.1.1 mb-stack \
  --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g
```

In another terminal from the project root:

```sh
anchor deploy --provider.cluster localnet
npm run test:er:local
```

The test reads `target/idl/meme_wars.json` and the wallet from `ANCHOR_WALLET` or `~/.config/solana/id.json`. Optional `BASE_RPC_URL` and `ER_RPC_URL` override the defaults. It airdrops locally if needed, initializes a unique match, delegates it, joins on ER, requests commit and undelegation, and asserts the final state by querying base RPC independently. No private key bytes are logged. The local feature override is solely for testing the existing legacy sBPF binary; a future sBPFv3 rebuild should remove that override. See the [Solana migration guide](https://solana.com/es/upgrades/sbpfv3-programs).

## Passing run with Agave 4.3.2 base and local feature override

| Step | Result | Signature / address |
| --- | --- | --- |
| Match PDA | Created on base | `2btFgWqkFaRaFBMxMa3VFpWLx1T8YSmxnArMSyaU2mkK` |
| Initialize | Passed | `5xNeKUaUiPdscLK3e6bkekrf5aCnrKR9bAX8ycT42PG3pYS8Nwh1FvcoWjJkLC3ozdpsF97b4YpW7PWTWdp5ukN1` |
| Delegate | Passed; base owner became delegation program and ER owner became game program | `3GWd6UULDCVLUBp85DFCnyms9An9MNJco5psRYRTuBSkigkyCLhhmhPnziLkaFLMJ495VT3PUmEERM67k2VEQ3mR` |
| Join/update on ER | Passed; ER account had one player and 1,000 credits | `4YpMbfBDeYBqW1CJreAx5YCtYWnQk1GUWEdZcpPA9AXVBAG2BDznmJjmn5QWXJkg1V9Uz5PRRSRP6Sn7eAU6hzkM` |
| Commit intent on ER | Passed | `TrxyLdRoxCSjwAATkn5NpYPLLpF9VdrPR7YDYQNjgy8pLE5FqBvZbhmcTFebcFr1fcYCYyUGV2SLA6uXNUuRihN` |
| Commit on base | Passed; independent base account read had one player and 1,000 credits | `4ygmfnwSDY3wFQCrcNMAnDPZTBjCWTxkPipdiqVipEkxUyq6emV4dzKnzE2ENiRxFTvx57LmPNuxLxGAG52hjh1s` |
| Undelegate intent on ER | Passed | `1CofTBu4acekwcqNtKPZ6QNf7CCckUJXAoFxFmG7itxkxteEHX9NLuocxhHzMKCh7MCGTADGGWEyyp2Ei9hZYBf` |
| Undelegate on base | Passed; account owner returned to game program and state remained intact | `4XTKQrmjd4iNwFGUd6rxb73iFNpUYmoKakdY8eugDHJ9yeZbeKarZ9vpA8ftFn1dHTbRdhEym7N9fbHCBryUbuin` |

## Observed run with Agave 3.1.10 base

| Step | Result | Signature / address |
| --- | --- | --- |
| Match PDA | Created on base | `6zVtLE37vGy42rpgYi8qghnRoTwBe1dCYCUBRVe1XrwR` |
| Initialize | Passed | `2qjNo1z1g9P9gfZe5mwteWrHKbGmUauA4NftKebehTPhrvERzxAWgvakEvAq7rJXeV3kjBSRrddBs4PX2aafScsf` |
| Delegate | Passed; base owner became delegation program and ER owner became game program | `5pGCVL6wrz2vUcBmybfu7kKYWK4HRvSRhxv6pZfyMeGeP9NXSi9QmrEtVgBE2cb5QG6b9JxFfpVwyMCy6LbNTBD9` |
| Join/update on ER | Passed; ER account had one player and 1,000 credits | `3uZtvZbFEykrvU2zS7eGDD4supmia1QdWbjHPuGE9SEGoRtsrMLxRtXN8FdPmJ5K7tP5S5HWayDqzKj7NeHR44Nh` |
| Commit intent on ER | Passed; scheduled commit ID 0 | `3SuCTLJpakrWWi4Svj1wihcQwzWMTZCg4uMdJRudQq4w7oZwzUDdBaqEuNXzbpTDnKSQWmfeUkiusfViMBh3fbtZ` |
| Scheduled commit | **Failed** | `4JsKGYoSMyHD2ZEUaCXfxK6FVrrryw8SSqz3CcechQbkG96AEszbwTW6U4LEJYpxanbDGTgu6XaQXAjGUEUSKGNd` |
| Base state read / undelegate | Not reached | — |

`solana confirm -u http://127.0.0.1:7799 -v <scheduled-signature>` showed `FailedToFinalizeError` and base RPC `SendTransaction` error `failed to deserialize solana_transaction::versioned::VersionedTransaction: io error: failed to fill whole buffer`. `GetCommitmentSignature` correctly rejected the failed scheduled transaction. The base validator did not confirm the commit.

## Agave 4.3.2 first attempt

The stack booted with an isolated official Agave 4.3.2 `solana-test-validator`. Deploying the existing program with `anchor deploy --provider.cluster localnet` initially failed during loader simulation with `Detected sbpf_version required by the executable which are not enabled` and `invalid account data for instruction`. Restarting the local stack with `--deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g` allowed deployment and the passing lifecycle above.

## Decision and remaining work

**GO for Phase 1:** the required independent base read of committed ER state was achieved, followed by successful undelegation. The current program is a legacy sBPF binary and needs a supported Anchor/SBF toolchain migration before deploying to a validator that enforces sBPFv3. That migration is outside this vertical slice.
