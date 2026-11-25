import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";

const { AnchorProvider, Program, Wallet, web3 } = anchor.default ?? anchor;
const match = process.argv[2];
if (!match) throw new Error("Pass the already-finalized match PDA as the first argument");
const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
const walletPath = process.env.ANCHOR_WALLET ?? path.join(homedir(), ".config/solana/id.json");
const authority = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(walletPath, "utf8"))));
const er = new web3.Connection(process.env.ER_RPC_URL ?? "http://127.0.0.1:7799", "confirmed");
const base = new web3.Connection(process.env.BASE_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const key = new web3.PublicKey(match);
const api = `${process.env.PROOF_API_URL ?? "http://localhost:3000"}/api/results/${match}/proof`;

async function post(action, intentSignature) {
  const response = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, intentSignature }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Proof API ${action}: ${body.error}`);
  return body;
}

const before = await er.getAccountInfo(key);
assert.ok(before?.owner.equals(new web3.PublicKey(idl.address)), "Finalized ER account must be program-owned");
const prepared = await post("prepare");
assert.equal(prepared.status, "pending");
assert.ok(!prepared.intentSignature, "An earlier intent is pending; do not submit another");
const program = new Program(idl, new AnchorProvider(er, new Wallet(authority), { commitment: "confirmed" }));
const intentSignature = await program.methods.undelegateMatch()
  .accountsPartial({ game: key, authority: authority.publicKey }).rpc();
console.log(`ER terminal intent: ${intentSignature}`);
const proof = await post("verify", intentSignature);
console.log(`Proof status: ${proof.status}; base signature: ${proof.baseSignature ?? "pending"}`);
assert.equal(proof.status, "verified", "Base settlement must match the finalized ER account");
const baseAccount = await base.getAccountInfo(key);
assert.ok(baseAccount?.owner.equals(new web3.PublicKey(idl.address)));
const reloaded = await (await fetch(api)).json();
assert.equal(reloaded.status, "verified", "Proof must survive a fresh read");
assert.equal(reloaded.baseSignature, proof.baseSignature);
console.log("PASS: terminal ER settlement and durable Solana proof");
