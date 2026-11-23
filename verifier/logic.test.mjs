import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import test from "node:test";
import * as anchor from "@coral-xyz/anchor";
import { authMessage, ChallengeStore, scoreTiming, verifyWalletMessage } from "./logic.mjs";

const { web3 } = anchor.default ?? anchor;
const PRIVATE_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signMessage(wallet, message) {
  const key = createPrivateKey({
    key: Buffer.concat([PRIVATE_PREFIX, Buffer.from(wallet.secretKey.subarray(0, 32))]),
    format: "der", type: "pkcs8",
  });
  return sign(null, message, key).toString("base64");
}

test("server timing bands are deterministic", () => {
  for (const [elapsed, expected] of [
    [1_500, 100], [1_400, 100], [1_600, 100],
    [1_250, 60], [1_750, 60], [1_100, 30], [1_900, 30],
    [1_099, 0], [1_901, 0],
  ]) assert.equal(scoreTiming(elapsed), expected);
  assert.throws(() => scoreTiming(-1));
});

test("wallet proof is bound to match and one-use authentication", () => {
  let now = 1_000_000;
  const store = new ChallengeStore(() => now);
  const wallet = web3.Keypair.generate();
  const other = web3.Keypair.generate();
  const match = web3.Keypair.generate().publicKey.toBase58();
  const nonce = store.issueAuth(match, wallet.publicKey.toBase58());
  const message = authMessage(match, wallet.publicKey.toBase58(), nonce);
  const signature = signMessage(wallet, message);
  assert.ok(verifyWalletMessage(wallet.publicKey.toBase58(), message, signature));
  assert.ok(!verifyWalletMessage(other.publicKey.toBase58(), message, signature));
  assert.ok(!store.consumeAuth(match, other.publicKey.toBase58(), nonce, signature));
  assert.ok(!store.consumeAuth(match, wallet.publicKey.toBase58(), nonce, signature));
  const fresh = store.issueAuth(match, wallet.publicKey.toBase58());
  assert.ok(store.consumeAuth(match, wallet.publicKey.toBase58(), fresh,
    signMessage(wallet, authMessage(match, wallet.publicKey.toBase58(), fresh))));
  assert.ok(!store.consumeAuth(match, wallet.publicKey.toBase58(), fresh, signature));
  const expired = store.issueAuth(match, wallet.publicKey.toBase58());
  now += 60_000;
  assert.ok(!store.consumeAuth(match, wallet.publicKey.toBase58(), expired,
    signMessage(wallet, authMessage(match, wallet.publicKey.toBase58(), expired))));
});

test("challenge tokens expire and cannot be consumed twice", () => {
  let now = 1_000_000;
  const store = new ChallengeStore(() => now);
  const first = store.issueChallenge("match", "wallet", 1, 1_100);
  assert.throws(() => store.issueChallenge("match", "wallet", 1, 1_100));
  now += 1_500;
  const consumed = store.consumeChallenge(first.id);
  assert.equal(consumed.elapsedMs, 1_500);
  assert.equal(consumed.attemptIndex, 1);
  assert.notEqual(consumed.nonce, 0n);
  assert.throws(() => store.consumeChallenge(first.id));
  const second = store.issueChallenge("match", "wallet", 1, 1_100);
  now += 31_000;
  assert.throws(() => store.consumeChallenge(second.id));
});
