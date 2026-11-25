import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import * as magicblock from "@magicblock-labs/ephemeral-rollups-sdk";
import { createVerifierServer } from "../verifier/server.mjs";
import { reconcileSettlement } from "../client/settlement.mjs";

const { AnchorProvider, BN, Program, Wallet, web3 } = anchor.default ?? anchor;
const { DELEGATION_PROGRAM_ID, GetCommitmentSignature } = magicblock;
const baseUrl = process.env.BASE_RPC_URL ?? "http://127.0.0.1:8899";
const erUrl = process.env.ER_RPC_URL ?? "http://127.0.0.1:7799";
const walletPath = process.env.ANCHOR_WALLET ?? path.join(homedir(), ".config/solana/id.json");
const localValidator = new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(state) {
  return {
    status: state.status, outcome: state.outcome,
    startedAt: String(state.startedAt), endsAt: String(state.endsAt),
    finalizedAt: String(state.finalizedAt), playerCount: state.playerCount,
    creditReserves: state.creditReserves.map(String),
    shareReserves: state.shareReserves.map(String),
    teamScores: state.teamScores.map(String),
    players: state.players.slice(0, state.playerCount).map((slot) => ({
      wallet: slot.wallet.toBase58(), credits: String(slot.credits),
      frogShares: String(slot.frogShares), catShares: String(slot.catShares),
      team: slot.team, bestScore: slot.bestScore,
      attemptsUsed: slot.attemptsUsed, tradeNonce: String(slot.tradeNonce),
      usedChallengeNonces: slot.usedChallengeNonces.map(String),
      perfectAttempts: slot.perfectAttempts,
    })),
  };
}

function assertConserved(state) {
  const players = state.players.slice(0, state.playerCount);
  const credits = state.creditReserves.reduce((sum, value) => sum + BigInt(value.toString()), 0n)
    + players.reduce((sum, player) => sum + BigInt(player.credits.toString()), 0n);
  assert.equal(credits, 20_000n + 1_000n * BigInt(state.playerCount));
  for (const [index, field] of ["frogShares", "catShares"].entries()) {
    const shares = BigInt(state.shareReserves[index].toString())
      + players.reduce((sum, player) => sum + BigInt(player[field].toString()), 0n);
    assert.equal(shares, 1_000_000_000n);
  }
  for (const team of [1, 2]) {
    const total = players.filter((player) => player.team === team)
      .reduce((sum, player) => sum + player.bestScore, 0);
    assert.equal(state.teamScores[team - 1].toNumber(), total);
  }
}

function buyOutput(credits, shares, input) {
  const k = credits * shares;
  const newCredits = credits + input;
  return shares - (k + newCredits - 1n) / newCredits;
}

function signMessage(wallet, message) {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const key = createPrivateKey({
    key: Buffer.concat([prefix, Buffer.from(wallet.secretKey.subarray(0, 32))]),
    format: "der", type: "pkcs8",
  });
  return sign(null, Buffer.from(message), key).toString("base64");
}

async function post(url, route, body) {
  const response = await fetch(`${url}${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${route}: ${value.error}`);
  return value;
}

async function poll(label, read, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await read()) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
  const programId = new web3.PublicKey(idl.address);
  const authority = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(walletPath, "utf8"))));
  assert.equal(authority.publicKey.toBase58(), "7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm");
  const cat = web3.Keypair.generate();
  const verifier = web3.Keypair.generate();
  const base = new web3.Connection(baseUrl, "confirmed");
  const erA = new web3.Connection(erUrl, "confirmed");
  const erB = new web3.Connection(erUrl, "confirmed");
  const baseProgram = new Program(idl, new AnchorProvider(base, new Wallet(authority), { commitment: "confirmed" }));
  const clientA = new Program(idl, new AnchorProvider(erA, new Wallet(authority), { commitment: "confirmed" }));
  const clientB = new Program(idl, new AnchorProvider(erB, new Wallet(cat), { commitment: "confirmed" }));
  await Promise.all([base.getVersion(), erA.getVersion(), erB.getVersion()]);
  if ((await base.getBalance(authority.publicKey)) < web3.LAMPORTS_PER_SOL) {
    const airdrop = await base.requestAirdrop(authority.publicKey, 5 * web3.LAMPORTS_PER_SOL);
    await base.confirmTransaction(airdrop, "confirmed");
  }
  const catFunding = await base.requestAirdrop(cat.publicKey, web3.LAMPORTS_PER_SOL);
  await base.confirmTransaction(catFunding, "confirmed");
  const matchId = new BN(Date.now());
  const [game] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("match"), authority.publicKey.toBuffer(), matchId.toArrayLike(Buffer, "le", 8)], programId,
  );
  console.log(`Program ${programId} | match ${matchId} | PDA ${game}`);
  const verifierServer = createVerifierServer({ idl, verifier, erUrl });
  await new Promise((resolve) => verifierServer.listen(0, "127.0.0.1", resolve));
  verifierServer.unref();
  const verifierUrl = `http://127.0.0.1:${verifierServer.address().port}`;
  try {
    const initSignature = await baseProgram.methods.initializeMatch(matchId, verifier.publicKey)
      .accountsPartial({ game, authority: authority.publicKey }).rpc();
    console.log(`Base initialize: ${initSignature}`);
    assert.equal((await base.getAccountInfo(game)).data.length, 1_086);
    const delegateSignature = await baseProgram.methods.delegateMatch(matchId)
      .accountsPartial({ authority: authority.publicKey, pda: game })
      .remainingAccounts([{ pubkey: localValidator, isSigner: false, isWritable: false }]).rpc();
    console.log(`Base delegate: ${delegateSignature}`);
    await poll("base delegation and ER ownership", async () => {
      const [baseAccount, erAccount] = await Promise.all([base.getAccountInfo(game), erA.getAccountInfo(game)]);
      return baseAccount?.owner.equals(DELEGATION_PROGRAM_ID) && erAccount?.owner.equals(programId);
    });

    const readBoth = async () => {
      const [a, b] = await Promise.all([clientA.account.match.fetch(game), clientB.account.match.fetch(game)]);
      assert.deepEqual(snapshot(a), snapshot(b));
      assertConserved(a);
      return a;
    };
    const aJoin = await clientA.methods.joinMatch()
      .accountsPartial({ game, player: authority.publicKey }).rpc();
    const bJoin = await clientB.methods.joinMatch()
      .accountsPartial({ game, player: cat.publicKey }).rpc();
    console.log(`ER joins: ${aJoin} ${bJoin}`);
    await clientA.methods.chooseTeam(1).accountsPartial({ game, player: authority.publicKey }).rpc();
    await clientB.methods.chooseTeam(2).accountsPartial({ game, player: cat.publicKey }).rpc();
    await readBoth();
    const startSignature = await clientA.methods.startMatch()
      .accountsPartial({ game, authority: authority.publicKey }).rpc();
    console.log(`ER start: ${startSignature}`);
    const started = await readBoth();
    assert.equal(started.endsAt.sub(started.startedAt).toNumber(), 90);

    const frogBuySignature = await clientA.methods.buyShares(0, new BN(100), new BN(1), new BN(0))
      .accountsPartial({ game, player: authority.publicKey }).rpc();
    console.log(`ER A Frog buy: ${frogBuySignature}`);
    const afterFrog = await readBoth();
    assert.equal(afterFrog.players[0].credits.toNumber(), 900);
    assert.equal(afterFrog.creditReserves[0].toNumber(), 10_100);
    assert.ok(afterFrog.players[0].frogShares.gt(new BN(0)));
    const staleCatOutput = buyOutput(10_000n, 1_000_000_000n, 100n);
    const catBuySignature = await clientB.methods.buyShares(1, new BN(100), new BN(1), new BN(0))
      .accountsPartial({ game, player: cat.publicKey }).rpc();
    console.log(`ER B Cat buy: ${catBuySignature}`);
    const afterCat = await readBoth();
    const beforeRejected = snapshot(afterCat);
    await assert.rejects(clientA.methods.buyShares(1, new BN(100), new BN(String(staleCatOutput)), new BN(1))
      .accountsPartial({ game, player: authority.publicKey }).rpc(), /SlippageExceeded|below the requested minimum/);
    assert.deepEqual(snapshot(await readBoth()), beforeRejected);
    const catSellSignature = await clientB.methods.sellShares(1, new BN(1_000_000), new BN(1), new BN(1))
      .accountsPartial({ game, player: cat.publicKey }).rpc();
    console.log(`ER B Cat sell: ${catSellSignature}`);
    const afterSell = await readBoth();
    assert.ok(afterSell.creditReserves[1].lt(afterCat.creditReserves[1]));
    assert.ok(afterSell.shareReserves[1].gt(afterCat.shareReserves[1]));
    assert.ok(afterSell.players[1].credits.gt(afterCat.players[1].credits));

    const match = game.toBase58();
    const wallet = authority.publicKey.toBase58();
    const auth = await post(verifierUrl, "/auth/nonce", { match, wallet });
    const challenge = await post(verifierUrl, "/challenge", {
      match, wallet, authNonce: auth.nonce, signature: signMessage(authority, auth.message),
    });
    await sleep(1_500);
    const result = await post(verifierUrl, "/attempt", { id: challenge.id, press: true });
    assert.ok([0, 30, 60, 100].includes(result.score));
    const transaction = web3.Transaction.from(Buffer.from(result.transaction, "base64"));
    transaction.partialSign(authority);
    const scoreSignature = await erA.sendRawTransaction(transaction.serialize());
    const scoreConfirmation = await erA.confirmTransaction(scoreSignature, "confirmed");
    assert.equal(scoreConfirmation.value.err, null);
    console.log(`ER server-verified score: ${scoreSignature} (${result.score})`);
    const afterScore = await readBoth();
    assert.equal(afterScore.teamScores[0].toNumber(), result.score);
    assert.equal(afterScore.players[0].attemptsUsed, 1);
    assert.deepEqual(afterScore.creditReserves.map(String), afterSell.creditReserves.map(String));
    assert.deepEqual(afterScore.shareReserves.map(String), afterSell.shareReserves.map(String));
    assert.equal(afterScore.players[0].credits.toString(), afterSell.players[0].credits.toString());

    while (Date.now() < started.endsAt.toNumber() * 1_000 + 200) {
      await sleep(Math.min(2_000, started.endsAt.toNumber() * 1_000 + 200 - Date.now()));
    }
    const closeSignature = await clientB.methods.closeMatch()
      .accountsPartial({ game, caller: cat.publicKey }).rpc();
    console.log(`ER close: ${closeSignature}`);
    assert.equal((await readBoth()).status, 2);
    const finalizeSignature = await clientB.methods.finalizeMatch()
      .accountsPartial({ game, caller: cat.publicKey }).rpc();
    console.log(`ER finalize: ${finalizeSignature}`);
    const finalState = await readBoth();
    assert.equal(finalState.status, 3);
    assert.equal(finalState.outcome, result.score > 0 ? 1 : 3);
    assert.ok(finalState.finalizedAt.toNumber() >= finalState.endsAt.toNumber());
    const finalSnapshot = snapshot(finalState);
    const duplicateFinalize = await clientA.methods.finalizeMatch()
      .accountsPartial({ game, caller: authority.publicKey }).rpc();
    console.log(`ER duplicate finalize: ${duplicateFinalize}`);
    assert.deepEqual(snapshot(await readBoth()), finalSnapshot);

    const proofApi = process.env.PROOF_API_URL;
    if (proofApi) {
      const prepared = await post(proofApi, `/api/results/${game}/proof`, { action: "prepare" });
      assert.equal(prepared.status, "pending");
      assert.ok(!prepared.intentSignature);
    }

    if (!process.env.PHASE8_TERMINAL_ONLY) {
      const commitIntent = await clientA.methods.commitMatch()
        .accountsPartial({ game, authority: authority.publicKey }).rpc();
      console.log(`ER commit intent: ${commitIntent}`);
      let injectedReadFailure = true;
      const committed = await reconcileSettlement({
        intentSignature: commitIntent,
        getBaseSignature: (signature) => GetCommitmentSignature(signature, erA),
        readBase: async () => {
          if (injectedReadFailure) {
            injectedReadFailure = false;
            throw new Error("injected transient base RPC read failure");
          }
          const [account, state] = await Promise.all([base.getAccountInfo(game), baseProgram.account.match.fetch(game)]);
          return { owner: account.owner.toBase58(), state };
        },
        matches: ({ owner, state }) => owner === DELEGATION_PROGRAM_ID.toBase58()
          && JSON.stringify(snapshot(state)) === JSON.stringify(finalSnapshot),
      });
      assert.ok(!injectedReadFailure);
      assert.ok(committed.baseSignature);
      console.log(`Base commit: ${committed.baseSignature}`);
    }

    const undelegateIntent = await clientA.methods.undelegateMatch()
      .accountsPartial({ game, authority: authority.publicKey }).rpc();
    console.log(`ER undelegate intent: ${undelegateIntent}`);
    const undelegated = await reconcileSettlement({
      intentSignature: undelegateIntent,
      getBaseSignature: (signature) => GetCommitmentSignature(signature, erA),
      readBase: async () => {
        const [account, state] = await Promise.all([base.getAccountInfo(game), baseProgram.account.match.fetch(game)]);
        return { owner: account.owner.toBase58(), state };
      },
      matches: ({ owner, state }) => owner === programId.toBase58()
        && JSON.stringify(snapshot(state)) === JSON.stringify(finalSnapshot),
    });
    assert.ok(undelegated.baseSignature);
    console.log(`Base undelegate: ${undelegated.baseSignature}`);
    if (proofApi) {
      const proof = await post(proofApi, `/api/results/${game}/proof`, { action: "verify", intentSignature: undelegateIntent });
      assert.equal(proof.status, "verified");
      assert.equal(proof.baseSignature, undelegated.baseSignature);
      const reloaded = await (await fetch(`${proofApi}/api/results/${game}/proof`)).json();
      assert.equal(reloaded.status, "verified");
      assert.equal(reloaded.baseSignature, undelegated.baseSignature);
      console.log(`Proof page: ${proofApi}/results/${game}/proof`);
    }
    console.log("PASS: two independent ER clients, finalized winner, and exact Solana settlement");
  } finally {
    verifierServer.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
