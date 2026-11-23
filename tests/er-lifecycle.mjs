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
const expectedMessages = {
  TeamsMissing: "Both teams need a player before the match starts",
  NotRegistered: "The player has not joined this match",
  AlreadyJoined: "This wallet already joined",
  InvalidTeam: "Choose Frog or Cat",
  TeamAlreadyChosen: "The player already chose a team",
  TeamFull: "This team's roster is full",
  InvalidStatus: "The match is in the wrong state",
  TooEarly: "The match deadline has not arrived",
  Closed: "The match is closed",
};

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

async function expectRejected(label, operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    const detail = `${error} ${JSON.stringify(error.error?.errorCode ?? {})} ${JSON.stringify(error.logs ?? [])}`;
    if (expectedCode && !detail.includes(expectedCode)
      && !detail.includes(expectedMessages[expectedCode])) {
      throw new Error(`${label} failed for the wrong reason: ${detail}`);
    }
    console.log(`Rejected as expected: ${label}`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  assert.equal(typeof GetCommitmentSignature, "function", "MagicBlock commitment helper is unavailable");
  const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
  const programId = new web3.PublicKey(idl.address);
  const secretBytes = JSON.parse(await readFile(walletPath, "utf8"));
  const wallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(secretBytes)));
  const verifier = web3.Keypair.generate().publicKey;
  const cat = web3.Keypair.generate();
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
  console.log(`Base ${baseUrl} | ER ${erUrl} | authority ${wallet.publicKey.toBase58()} | verifier ${verifier.toBase58()}`);

  const initSignature = await baseProgram.methods
    .initializeMatch(matchId, verifier)
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`Base initialize: ${initSignature}`);
  const initial = await baseProgram.account.match.fetch(game);
  const initialAccount = await base.getAccountInfo(game);
  assert.equal(initialAccount.data.length, 756);
  assert.equal(initial.playerCount, 0);
  assert.equal(initial.matchId.toString(), matchId.toString());
  assert.equal(initial.verifier.toBase58(), verifier.toBase58());
  assert.deepEqual(initial.creditReserves.map((value) => value.toString()), ["10000", "10000"]);
  assert.deepEqual(initial.shareReserves.map((value) => value.toString()), ["1000000000", "1000000000"]);
  await expectRejected("duplicate initialization", () => baseProgram.methods
    .initializeMatch(matchId, verifier)
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc());

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

  await expectRejected("start without teams", () => erProgram.methods
    .startMatch().accountsPartial({ game, authority: wallet.publicKey }).rpc(), "TeamsMissing");
  await expectRejected("unregistered team choice", () => erProgram.methods
    .chooseTeam(2).accountsPartial({ game, player: cat.publicKey }).signers([cat]).rpc(), "NotRegistered");

  const joinSignature = await erProgram.methods
    .joinMatch()
    .accountsPartial({ game, player: wallet.publicKey })
    .rpc();
  console.log(`ER Frog join: ${joinSignature}`);
  await expectRejected("duplicate join", () => erProgram.methods
    .joinMatch().accountsPartial({ game, player: wallet.publicKey })
    .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 180_000 })])
    .rpc(), "AlreadyJoined");
  const reloaded = await erProgram.account.match.fetch(game);
  assert.equal(reloaded.playerCount, 1);
  assert.equal(reloaded.players[0].credits.toString(), "1000");
  await expectRejected("invalid team", () => erProgram.methods
    .chooseTeam(3).accountsPartial({ game, player: wallet.publicKey }).rpc(), "InvalidTeam");
  const frogTeamSignature = await erProgram.methods
    .chooseTeam(1).accountsPartial({ game, player: wallet.publicKey }).rpc();
  console.log(`ER Frog team: ${frogTeamSignature}`);
  await expectRejected("team change", () => erProgram.methods
    .chooseTeam(2).accountsPartial({ game, player: wallet.publicKey }).rpc(), "TeamAlreadyChosen");
  await expectRejected("start with one team", () => erProgram.methods
    .startMatch().accountsPartial({ game, authority: wallet.publicKey }).rpc(), "TeamsMissing");

  const catJoinSignature = await erProgram.methods
    .joinMatch().accountsPartial({ game, player: cat.publicKey }).signers([cat]).rpc();
  console.log(`ER Cat join: ${catJoinSignature}`);
  const catTeamSignature = await erProgram.methods
    .chooseTeam(2).accountsPartial({ game, player: cat.publicKey }).signers([cat]).rpc();
  console.log(`ER Cat team: ${catTeamSignature}`);

  for (const player of Array.from({ length: 4 }, () => web3.Keypair.generate())) {
    await erProgram.methods.joinMatch().accountsPartial({ game, player: player.publicKey }).signers([player]).rpc();
    await erProgram.methods.chooseTeam(1).accountsPartial({ game, player: player.publicKey }).signers([player]).rpc();
  }
  const overflowPlayer = web3.Keypair.generate();
  await erProgram.methods.joinMatch()
    .accountsPartial({ game, player: overflowPlayer.publicKey }).signers([overflowPlayer]).rpc();
  await expectRejected("sixth Frog roster slot", () => erProgram.methods
    .chooseTeam(1).accountsPartial({ game, player: overflowPlayer.publicKey })
    .signers([overflowPlayer]).rpc(), "TeamFull");
  await erProgram.methods.chooseTeam(2)
    .accountsPartial({ game, player: overflowPlayer.publicKey }).signers([overflowPlayer]).rpc();

  await expectRejected("unauthorized start", () => erProgram.methods
    .startMatch().accountsPartial({ game, authority: cat.publicKey }).signers([cat]).rpc());
  const startSignature = await erProgram.methods
    .startMatch().accountsPartial({ game, authority: wallet.publicKey }).rpc();
  console.log(`ER start: ${startSignature}`);
  const started = await erProgram.account.match.fetch(game);
  assert.equal(started.status, 1);
  assert.equal(started.endsAt.sub(started.startedAt).toNumber(), 90);
  await expectRejected("duplicate start", () => erProgram.methods
    .startMatch().accountsPartial({ game, authority: wallet.publicKey })
    .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 180_001 })])
    .rpc(), "InvalidStatus");
  await expectRejected("early close", () => erProgram.methods
    .closeMatch().accountsPartial({ game, caller: cat.publicKey }).signers([cat]).rpc(), "TooEarly");
  await expectRejected("premature undelegation", () => erProgram.methods
    .undelegateMatch().accountsPartial({ game, authority: wallet.publicKey }).rpc(), "InvalidStatus");

  const livePlayer = web3.Keypair.generate();
  await erProgram.methods.joinMatch()
    .accountsPartial({ game, player: livePlayer.publicKey }).signers([livePlayer]).rpc();
  await erProgram.methods.chooseTeam(2)
    .accountsPartial({ game, player: livePlayer.publicKey }).signers([livePlayer]).rpc();
  const liveState = await erProgram.account.match.fetch(game);
  assert.equal(liveState.playerCount, 8);
  assert.equal(liveState.players[7].credits.toString(), "1000");

  let closeSignature;
  const closeDeadline = Date.now() + 135_000;
  while (!closeSignature && Date.now() < closeDeadline) {
    const remaining = liveState.endsAt.toNumber() * 1000 - Date.now();
    if (remaining > 0) {
      await sleep(Math.min(remaining + 200, 2_000));
      continue;
    }
    try {
      closeSignature = await erProgram.methods.closeMatch()
        .accountsPartial({ game, caller: cat.publicKey }).signers([cat]).rpc();
    } catch (error) {
      if (!`${error}`.includes("TooEarly")) throw error;
      await sleep(500);
    }
  }
  assert.ok(closeSignature, "the ER clock did not reach the 90-second deadline");
  console.log(`ER close: ${closeSignature}`);
  await expectRejected("duplicate close", () => erProgram.methods
    .closeMatch().accountsPartial({ game, caller: cat.publicKey }).signers([cat])
    .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 180_002 })])
    .rpc(), "InvalidStatus");
  const latePlayer = web3.Keypair.generate();
  await expectRejected("join after deadline", () => erProgram.methods
    .joinMatch().accountsPartial({ game, player: latePlayer.publicKey })
    .signers([latePlayer]).rpc(), "Closed");
  await expectRejected("team choice after close", () => erProgram.methods
    .chooseTeam(1).accountsPartial({ game, player: cat.publicKey }).signers([cat]).rpc(), "Closed");
  const closedState = await erProgram.account.match.fetch(game);
  assert.equal(closedState.status, 2);
  assert.equal(closedState.outcome, 0);
  assert.equal(closedState.finalizedAt.toString(), "0");

  const commitSignature = await erProgram.methods
    .commitMatch()
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`ER commit intent: ${commitSignature}`);
  const baseCommitSignature = await GetCommitmentSignature(commitSignature, er);
  console.log(`Base commit: ${baseCommitSignature}`);
  await poll("committed state on base", async () => {
    const state = await baseProgram.account.match.fetch(game);
    return state.playerCount === 8 && state.status === 2
      && state.players.every((player, index) => index >= 8 || player.credits.toString() === "1000") && state;
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
    return state.playerCount === 8 && state.status === 2
      && state.players.every((player, index) => index >= 8 || player.credits.toString() === "1000") && state;
  });

  console.log("PASS: 90-second ER lifecycle and final base-layer state match");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
