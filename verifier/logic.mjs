import { createPublicKey, randomBytes, verify } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";

const { web3 } = anchor.default ?? anchor;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const TARGET_MS = 1_500;

export function scoreTiming(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Invalid elapsed time");
  const distance = Math.abs(elapsedMs - TARGET_MS);
  return distance <= 100 ? 100 : distance <= 250 ? 60 : distance <= 400 ? 30 : 0;
}

export function authMessage(match, wallet, nonce) {
  return Buffer.from(`MemeWarsChallenge:v1\nmatch=${match}\nwallet=${wallet}\nauth_nonce=${nonce}`, "utf8");
}

export function verifyWalletMessage(wallet, message, signatureBase64) {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, new web3.PublicKey(wallet).toBuffer()]),
      format: "der",
      type: "spki",
    });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

export class ChallengeStore {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.auth = new Map();
    this.challenges = new Map();
  }

  issueAuth(match, wallet) {
    const nonce = randomBytes(16).toString("hex");
    this.auth.set(nonce, { match, wallet, expiresMs: this.now() + 60_000 });
    return nonce;
  }

  consumeAuth(match, wallet, nonce, signature) {
    const entry = this.auth.get(nonce);
    this.auth.delete(nonce);
    return !!entry && entry.match === match && entry.wallet === wallet
      && this.now() < entry.expiresMs
      && verifyWalletMessage(wallet, authMessage(match, wallet, nonce), signature);
  }

  issueChallenge(match, wallet, attemptIndex, endsAt) {
    const nowMs = this.now();
    for (const entry of this.challenges.values()) {
      if (entry.match === match && entry.wallet === wallet && !entry.used
        && nowMs <= entry.expiresAt * 1_000) {
        throw new Error("An unused challenge is already active");
      }
    }
    const expiresAt = Math.min(Math.floor(nowMs / 1_000) + 30, endsAt);
    if (expiresAt <= Math.floor(nowMs / 1_000)) throw new Error("The round is ending");
    const id = randomBytes(16).toString("hex");
    let nonce = 0n;
    while (nonce === 0n) nonce = randomBytes(8).readBigUInt64LE();
    const entry = { id, match, wallet, attemptIndex, nonce, issuedMs: nowMs, expiresAt, used: false };
    this.challenges.set(id, entry);
    return entry;
  }

  consumeChallenge(id) {
    const entry = this.challenges.get(id);
    if (!entry || entry.used || this.now() > entry.expiresAt * 1_000) {
      throw new Error("Challenge missing, used, or expired");
    }
    entry.used = true;
    this.challenges.delete(id);
    return { ...entry, elapsedMs: this.now() - entry.issuedMs };
  }
}
