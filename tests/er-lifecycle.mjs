import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createPrivateKey, sign } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";
import * as magicblock from "@magicblock-labs/ephemeral-rollups-sdk";
import { createVerifierServer } from "../verifier/server.mjs";

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
  InvalidPool: "Choose Frog or Cat pool",
  InvalidTradeAmount: "Trade input or minimum output is outside its allowed range",
  InsufficientCredits: "This wallet has insufficient virtual credits",
  InsufficientShares: "This wallet has insufficient virtual shares",
  SlippageExceeded: "The trade output is below the requested minimum",
  InvalidNonce: "The trade nonce does not match",
  InvalidOrganizer: "Only the approved demo organizer may create a match",
  InvalidScore: "The timing score is invalid",
  InvalidChallengeNonce: "The timing challenge nonce is invalid or already used",
  InvalidAttemptIndex: "The attempt index is not next in sequence",
  AttemptLimit: "The three-attempt limit has been reached",
  AttemptExpired: "The timing challenge result has expired",
  TeamNotChosen: "The scoring team has not been chosen",
};

function signWalletMessage(keypair, message) {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([prefix, Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: "der", type: "pkcs8",
  });
  return sign(null, Buffer.from(message), privateKey).toString("base64");
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${route}: ${value.error}`);
  return value;
}

function buyOutput(credits, shares, input) {
  const k = credits * shares;
  const newCredits = credits + input;
  const newShares = (k + newCredits - 1n) / newCredits;
  return shares - newShares;
}

function snapshot(state) {
  return {
    status: state.status, outcome: state.outcome,
    finalizedAt: String(state.finalizedAt),
    teamScores: state.teamScores.map(String),
    creditReserves: state.creditReserves.map(String),
    shareReserves: state.shareReserves.map(String),
    players: state.players.slice(0, state.playerCount).map((player) => ({
      wallet: player.wallet.toBase58(), credits: String(player.credits),
      frogShares: String(player.frogShares), catShares: String(player.catShares),
      tradeNonce: String(player.tradeNonce),
      bestScore: player.bestScore, attemptsUsed: player.attemptsUsed,
      perfectAttempts: player.perfectAttempts,
      usedChallengeNonces: player.usedChallengeNonces.map(String),
    })),
  };
}

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
  const verifier = web3.Keypair.generate();
  const cat = web3.Keypair.generate();
  const base = new web3.Connection(baseUrl, "confirmed");
  const er = new web3.Connection(erUrl, "confirmed");
  const baseProgram = new Program(idl, new AnchorProvider(base, wallet, { commitment: "confirmed" }));
  const erProgram = new Program(idl, new AnchorProvider(er, wallet, { commitment: "confirmed" }));
  const verifierServer = createVerifierServer({ idl, verifier, erUrl });
  await new Promise((resolve) => verifierServer.listen(0, "127.0.0.1", resolve));
  verifierServer.unref();
  const verifierUrl = `http://127.0.0.1:${verifierServer.address().port}`;

  async function completeAttempt(playerKeypair, waitMs = 1_500) {
    const match = game.toBase58();
    const player = playerKeypair.publicKey.toBase58();
    const auth = await postJson(verifierUrl, "/auth/nonce", { match, wallet: player });
    const challenge = await postJson(verifierUrl, "/challenge", {
      match, wallet: player, authNonce: auth.nonce,
      signature: signWalletMessage(playerKeypair, auth.message),
    });
    await sleep(waitMs);
    const result = await postJson(verifierUrl, "/attempt", { id: challenge.id, press: true });
    assert.ok([0, 30, 60, 100].includes(result.score));
    const transaction = web3.Transaction.from(Buffer.from(result.transaction, "base64"));
    transaction.partialSign(playerKeypair);
    const signature = await er.sendRawTransaction(transaction.serialize());
    const confirmation = await er.confirmTransaction(signature, "confirmed");
    assert.equal(confirmation.value.err, null);
    console.log(`ER verified attempt ${player} #${challenge.attemptIndex}: ${signature} score ${result.score}`);
    return { ...result, id: challenge.id, nonce: challenge.nonce, signature };
  }

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
  assert.equal(wallet.publicKey.toBase58(), "7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm");
  console.log(`Base ${baseUrl} | ER ${erUrl} | authority ${wallet.publicKey.toBase58()} | verifier ${verifier.publicKey.toBase58()}`);

  const initSignature = await baseProgram.methods
    .initializeMatch(matchId, verifier.publicKey)
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`Base initialize: ${initSignature}`);
  const initial = await baseProgram.account.match.fetch(game);
  const initialAccount = await base.getAccountInfo(game);
  assert.equal(initialAccount.data.length, 1086);
  assert.equal(initial.playerCount, 0);
  assert.equal(initial.matchId.toString(), matchId.toString());
  assert.equal(initial.verifier.toBase58(), verifier.publicKey.toBase58());
  assert.deepEqual(initial.creditReserves.map((value) => value.toString()), ["10000", "10000"]);
  assert.deepEqual(initial.shareReserves.map((value) => value.toString()), ["1000000000", "1000000000"]);
  const catFunding = await base.requestAirdrop(cat.publicKey, web3.LAMPORTS_PER_SOL);
  await base.confirmTransaction(catFunding, "confirmed");
  const [unauthorizedGame] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("match"), cat.publicKey.toBuffer(), matchId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  await expectRejected("unapproved organizer initialization", () => baseProgram.methods
    .initializeMatch(matchId, verifier.publicKey)
    .accountsPartial({ game: unauthorizedGame, authority: cat.publicKey })
    .signers([cat]).rpc(), "InvalidOrganizer");
  await expectRejected("duplicate initialization", () => baseProgram.methods
    .initializeMatch(matchId, verifier.publicKey)
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

  const outsiderTrader = web3.Keypair.generate();
  await expectRejected("unregistered trade", () => erProgram.methods
    .buyShares(0, new BN(1), new BN(1), new BN(0))
    .accountsPartial({ game, player: outsiderTrader.publicKey }).signers([outsiderTrader]).rpc(), "NotRegistered");
  await expectRejected("invalid pool", () => erProgram.methods
    .buyShares(2, new BN(100), new BN(1), new BN(0))
    .accountsPartial({ game, player: wallet.publicKey }).rpc(), "InvalidPool");
  await expectRejected("zero buy", () => erProgram.methods
    .buyShares(0, new BN(0), new BN(1), new BN(0))
    .accountsPartial({ game, player: wallet.publicKey }).rpc(), "InvalidTradeAmount");
  await expectRejected("buy over cap", () => erProgram.methods
    .buyShares(0, new BN(251), new BN(1), new BN(0))
    .accountsPartial({ game, player: wallet.publicKey }).rpc(), "InvalidTradeAmount");
  await expectRejected("sell unowned shares", () => erProgram.methods
    .sellShares(0, new BN(1_000_000), new BN(1), new BN(0))
    .accountsPartial({ game, player: wallet.publicKey }).rpc(), "InsufficientShares");
  const frogBuySignature = await erProgram.methods
    .buyShares(0, new BN(100), new BN(1), new BN(0))
    .accountsPartial({ game, player: wallet.publicKey }).rpc();
  console.log(`ER Frog buy: ${frogBuySignature}`);
  const afterFrogBuy = await erProgram.account.match.fetch(game);
  assert.equal(afterFrogBuy.players[0].credits.toString(), "900");
  assert.equal(afterFrogBuy.players[0].tradeNonce.toString(), "1");
  assert.equal(afterFrogBuy.creditReserves[1].toString(), "10000");
  await expectRejected("replayed buy nonce", () => erProgram.methods
    .buyShares(0, new BN(100), new BN(1), new BN(0))
    .accountsPartial({ game, player: wallet.publicKey })
    .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 180_003 })])
    .rpc(), "InvalidNonce");
  const staleCatOutput = buyOutput(10_000n, 1_000_000_000n, 100n);
  const catBuySignature = await erProgram.methods
    .buyShares(1, new BN(100), new BN(staleCatOutput.toString()), new BN(0))
    .accountsPartial({ game, player: cat.publicKey }).signers([cat]).rpc();
  console.log(`ER Cat buy: ${catBuySignature}`);
  await expectRejected("stale Cat slippage quote", () => erProgram.methods
    .buyShares(1, new BN(100), new BN(staleCatOutput.toString()), new BN(1))
    .accountsPartial({ game, player: wallet.publicKey }).rpc(), "SlippageExceeded");
  assert.equal((await erProgram.account.match.fetch(game)).players[0].tradeNonce.toString(), "1");
  const frogSellSignature = await erProgram.methods
    .sellShares(0, new BN(1_000_000), new BN(1), new BN(1))
    .accountsPartial({ game, player: wallet.publicKey }).rpc();
  console.log(`ER Frog sell: ${frogSellSignature}`);
  const catSellSignature = await erProgram.methods
    .sellShares(1, new BN(1_000_000), new BN(1), new BN(1))
    .accountsPartial({ game, player: cat.publicKey }).signers([cat]).rpc();
  console.log(`ER Cat sell: ${catSellSignature}`);
  const tradedState = await erProgram.account.match.fetch(game);
  assert.equal(tradedState.players[0].tradeNonce.toString(), "2");
  assert.equal(tradedState.players[1].tradeNonce.toString(), "2");
  assert.ok(tradedState.players[0].credits.toNumber() <= 1_000);
  assert.ok(tradedState.players[1].credits.toNumber() <= 1_000);

  const wrongVerifier = web3.Keypair.generate();
  const scoreExpiry = started.endsAt;
  await expectRejected("score without verifier signature", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(1001), 100, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey }).rpc());
  await expectRejected("wrong verifier signer", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(1002), 100, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: wrongVerifier.publicKey })
    .signers([wrongVerifier]).rpc());
  await expectRejected("forged numeric score", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(1003), 99, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey })
    .signers([verifier]).rpc(), "InvalidScore");
  await expectRejected("expired result", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(1004), 100, new BN(Math.floor(Date.now() / 1_000) - 1))
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey })
    .signers([verifier]).rpc(), "AttemptExpired");
  await expectRejected("other wallet scoring slot", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(1005), 100, scoreExpiry)
    .accountsPartial({ game, player: outsiderTrader.publicKey, verifier: verifier.publicKey })
    .signers([outsiderTrader, verifier]).rpc(), "NotRegistered");
  const invalidAuth = await postJson(verifierUrl, "/auth/nonce", {
    match: game.toBase58(), wallet: cat.publicKey.toBase58(),
  });
  await expectRejected("wrong wallet challenge authentication", () => postJson(verifierUrl, "/challenge", {
    match: game.toBase58(), wallet: cat.publicKey.toBase58(), authNonce: invalidAuth.nonce,
    signature: signWalletMessage(wallet.payer, invalidAuth.message),
  }));
  const frogResult = await completeAttempt(wallet.payer);
  const afterScore = await erProgram.account.match.fetch(game);
  assert.equal(afterScore.players[0].attemptsUsed, 1);
  assert.equal(afterScore.players[0].bestScore, frogResult.score);
  assert.equal(afterScore.teamScores[0].toNumber(), frogResult.score);
  await expectRejected("reused challenge nonce", () => erProgram.methods
    .submitVerifiedAttempt(2, new BN(frogResult.nonce), 100, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey })
    .signers([verifier]).rpc(), "InvalidChallengeNonce");
  await expectRejected("reused server challenge", () => postJson(verifierUrl, "/attempt", {
    id: frogResult.id, press: true,
  }));
  await erProgram.methods.submitVerifiedAttempt(2, new BN(1006), 30, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey })
    .signers([verifier]).rpc();
  await erProgram.methods.submitVerifiedAttempt(3, new BN(1007), 100, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey })
    .signers([verifier]).rpc();
  await expectRejected("fourth attempt", () => erProgram.methods
    .submitVerifiedAttempt(4, new BN(1006), 100, scoreExpiry)
    .accountsPartial({ game, player: wallet.publicKey, verifier: verifier.publicKey })
    .signers([verifier]).rpc(), "AttemptLimit");
  const scored = await erProgram.account.match.fetch(game);
  assert.equal(scored.teamScores[0].toNumber(), 100);
  assert.equal(scored.teamScores[1].toNumber(), 0);
  assert.equal(scored.players[0].perfectAttempts,
    (frogResult.score === 100 ? 1 : 0) + 1);

  const livePlayer = web3.Keypair.generate();
  await erProgram.methods.joinMatch()
    .accountsPartial({ game, player: livePlayer.publicKey }).signers([livePlayer]).rpc();
  await expectRejected("unchosen scoring team", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(2001), 30, scoreExpiry)
    .accountsPartial({ game, player: livePlayer.publicKey, verifier: verifier.publicKey })
    .signers([livePlayer, verifier]).rpc(), "TeamNotChosen");
  await erProgram.methods.chooseTeam(2)
    .accountsPartial({ game, player: livePlayer.publicKey }).signers([livePlayer]).rpc();
  const liveState = await erProgram.account.match.fetch(game);
  assert.equal(liveState.playerCount, 8);
  assert.equal(liveState.players[7].credits.toString(), "1000");
  const tradedSnapshot = snapshot(liveState);

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
  await expectRejected("trade after close", () => erProgram.methods
    .buyShares(0, new BN(1), new BN(1), new BN(2))
    .accountsPartial({ game, player: wallet.publicKey }).rpc(), "Closed");
  await expectRejected("score after close", () => erProgram.methods
    .submitVerifiedAttempt(1, new BN(2002), 100, new BN(Math.floor(Date.now() / 1_000) + 30))
    .accountsPartial({ game, player: livePlayer.publicKey, verifier: verifier.publicKey })
    .signers([livePlayer, verifier]).rpc(), "Closed");
  const closedState = await erProgram.account.match.fetch(game);
  assert.equal(closedState.status, 2);
  assert.equal(closedState.outcome, 0);
  assert.equal(closedState.finalizedAt.toString(), "0");
  const finalizeSignature = await erProgram.methods.finalizeMatch()
    .accountsPartial({ game, caller: cat.publicKey }).signers([cat]).rpc();
  console.log(`ER finalize: ${finalizeSignature}`);
  const finalState = await erProgram.account.match.fetch(game);
  assert.equal(finalState.status, 3);
  assert.equal(finalState.outcome, 1);
  assert.ok(finalState.finalizedAt.toNumber() >= finalState.endsAt.toNumber());
  const finalSnapshot = snapshot(finalState);
  assert.deepEqual(finalSnapshot.players, tradedSnapshot.players);
  await erProgram.methods.finalizeMatch()
    .accountsPartial({ game, caller: cat.publicKey }).signers([cat])
    .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 180_005 })])
    .rpc();
  assert.deepEqual(snapshot(await erProgram.account.match.fetch(game)), finalSnapshot);

  const commitSignature = await erProgram.methods
    .commitMatch()
    .accountsPartial({ game, authority: wallet.publicKey })
    .rpc();
  console.log(`ER commit intent: ${commitSignature}`);
  const baseCommitSignature = await GetCommitmentSignature(commitSignature, er);
  console.log(`Base commit: ${baseCommitSignature}`);
  await poll("committed state on base", async () => {
    const state = await baseProgram.account.match.fetch(game);
    return state.playerCount === 8 && state.status === 3
      && JSON.stringify(snapshot(state)) === JSON.stringify(finalSnapshot) && state;
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
    return state.playerCount === 8 && state.status === 3
      && JSON.stringify(snapshot(state)) === JSON.stringify(finalSnapshot) && state;
  });

  verifierServer.close();
  console.log("PASS: server-verified scores, virtual trades, and final base-layer state match");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
