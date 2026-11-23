import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import * as magicblock from "@magicblock-labs/ephemeral-rollups-sdk";

const { AnchorProvider, BN, Program, Wallet, web3 } = anchor.default ?? anchor;
const { DELEGATION_PROGRAM_ID, GetCommitmentSignature } = magicblock;
const baseUrl = process.env.BASE_RPC_URL ?? "http://127.0.0.1:8899";
const erUrl = process.env.ER_RPC_URL ?? "http://127.0.0.1:7799";
const walletPath = process.env.ANCHOR_WALLET ?? path.join(homedir(), ".config/solana/id.json");
const localValidator = new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");

async function poll(label, operation, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function main() {
  assert.equal(typeof GetCommitmentSignature, "function", "MagicBlock commitment helper is unavailable");
  const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
  const programId = new web3.PublicKey(idl.address);
  const secretBytes = JSON.parse(await readFile(walletPath, "utf8"));
  const wallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(secretBytes)));
  const base = new web3.Connection(baseUrl, "confirmed");
  const er = new web3.Connection(erUrl, "confirmed");
  const baseProgram = new Program(idl, new AnchorProvider(base, wallet, { commitment: "confirmed" }));
  const erProgram = new Program(idl, new AnchorProvider(er, wallet, { commitment: "confirmed" }));

  await Promise.all([base.getVersion(), er.getVersion()]);
  if ((await base.getBalance(wallet.publicKey)) < web3.LAMPORTS_PER_SOL) {
    const airdrop = await base.requestAirdrop(wallet.publicKey, 5 * web3.LAMPORTS_PER_SOL);
    await base.confirmTransaction(airdrop, "confirmed");
  }

  const matchId = new BN(Date.now());
  const [game] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("match"), wallet.publicKey.toBuffer(), matchId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  console.log(`Program ${programId.toBase58()} | match ${matchId.toString()} | PDA ${game.toBase58()}`);
  console.log(`Base ${baseUrl} | ER ${erUrl} | authority ${wallet.publicKey.toBase58()}`);

  const initSignature = await baseProgram.methods
    .initializeMatch(matchId)
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`Base initialize: ${initSignature}`);
  const initial = await baseProgram.account.match.fetch(game);
  assert.equal(initial.playerCount, 0);
  assert.equal(initial.matchId.toString(), matchId.toString());

  const delegateSignature = await baseProgram.methods
    .delegateMatch(matchId)
    .accountsPartial({ authority: wallet.publicKey, pda: game })
    .remainingAccounts([{ pubkey: localValidator, isSigner: false, isWritable: false }])
    .rpc();
  console.log(`Base delegate: ${delegateSignature}`);
  await poll("delegation ownership on base", async () => {
    const account = await base.getAccountInfo(game);
    return account?.owner.equals(DELEGATION_PROGRAM_ID) && account;
  });
  await poll("program ownership on ER", async () => {
    const account = await er.getAccountInfo(game);
    return account?.owner.equals(programId) && account;
  });

  const joinSignature = await erProgram.methods
    .joinMatch()
    .accountsPartial({ game, player: wallet.publicKey })
    .rpc();
  console.log(`ER join: ${joinSignature}`);
  await poll("ER match update", async () => {
    const state = await erProgram.account.match.fetch(game);
    return state.playerCount === 1 && state.players[0].credits.toString() === "1000" && state;
  });

  const commitSignature = await erProgram.methods
    .commitMatch()
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`ER commit intent: ${commitSignature}`);
  const baseCommitSignature = await GetCommitmentSignature(commitSignature, er);
  console.log(`Base commit: ${baseCommitSignature}`);
  await poll("committed state on base", async () => {
    const state = await baseProgram.account.match.fetch(game);
    return state.playerCount === 1 && state.players[0].credits.toString() === "1000" && state;
  });

  const undelegateSignature = await erProgram.methods
    .undelegateMatch()
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`ER undelegate intent: ${undelegateSignature}`);
  const baseUndelegateSignature = await GetCommitmentSignature(undelegateSignature, er);
  console.log(`Base undelegate: ${baseUndelegateSignature}`);
  await poll("program ownership and final state on base", async () => {
    const account = await base.getAccountInfo(game);
    if (!account?.owner.equals(programId)) return false;
    const state = await baseProgram.account.match.fetch(game);
    return state.playerCount === 1 && state.players[0].credits.toString() === "1000" && state;
  });

  console.log("PASS: ER update and final base-layer state match");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
