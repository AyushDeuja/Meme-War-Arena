import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as anchor from "@coral-xyz/anchor";
import { authMessage, ChallengeStore, scoreTiming, TARGET_MS } from "./logic.mjs";

const { AnchorProvider, BN, Program, Wallet, web3 } = anchor.default ?? anchor;
const ORGANIZER = "7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm";

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8_192) throw new Error("Request body is too large");
  }
  return JSON.parse(body);
}

function checkKeys(body, expected) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !expected.includes(key))
    || expected.some((key) => !(key in body))) {
    throw new Error("Unexpected request fields");
  }
}

export function createVerifierServer({ idl, verifier, erUrl, allowedOrigin = "http://localhost:3000", now = () => Date.now() }) {
  const er = new web3.Connection(erUrl, "confirmed");
  const program = new Program(idl, new AnchorProvider(er, new Wallet(verifier), { commitment: "confirmed" }));
  const store = new ChallengeStore(now);
  const counts = new Map();
  function limit(key, maximum) {
    const current = now();
    const previous = counts.get(key);
    const entry = !previous || current - previous.startedMs >= 60_000
      ? { startedMs: current, count: 0 } : previous;
    entry.count += 1;
    counts.set(key, entry);
    if (entry.count > maximum) throw new Error("Rate limit reached");
  }
  async function loadMatch(match, wallet) {
    const game = new web3.PublicKey(match);
    const player = new web3.PublicKey(wallet);
    const state = await program.account.match.fetch(game);
    if (state.authority.toBase58() !== ORGANIZER
      || state.verifier.toBase58() !== verifier.publicKey.toBase58()
      || state.status !== 1 || now() >= state.endsAt.toNumber() * 1_000) {
      throw new Error("Match is not live or verifier is not approved");
    }
    const index = state.players.slice(0, state.playerCount)
      .findIndex((slot) => slot.wallet.equals(player));
    if (index < 0 || ![1, 2].includes(state.players[index].team)
      || state.players[index].attemptsUsed >= 3) {
      throw new Error("Wallet has no available scoring slot");
    }
    return { game, player, state, slot: state.players[index] };
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        if (req.headers.origin !== allowedOrigin) throw new Error("Origin not allowed");
        res.writeHead(204, {
          "access-control-allow-origin": allowedOrigin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }
      if (req.headers.origin && req.headers.origin !== allowedOrigin) throw new Error("Origin not allowed");
      if (req.headers.origin) res.setHeader("access-control-allow-origin", allowedOrigin);
      if (req.method !== "POST") return send(res, 405, { error: "POST required" });
      limit(`ip:${req.socket.remoteAddress}`, 30);
      const body = await readJson(req);
      if (req.url === "/auth/nonce") {
        checkKeys(body, ["match", "wallet"]);
        new web3.PublicKey(body.match);
        new web3.PublicKey(body.wallet);
        limit(`wallet:${body.wallet}`, 12);
        const nonce = store.issueAuth(body.match, body.wallet);
        return send(res, 200, { nonce, message: authMessage(body.match, body.wallet, nonce).toString("utf8") });
      }
      if (req.url === "/challenge") {
        checkKeys(body, ["match", "wallet", "authNonce", "signature"]);
        limit(`wallet:${body.wallet}`, 12);
        if (!store.consumeAuth(body.match, body.wallet, body.authNonce, body.signature)) {
          return send(res, 403, { error: "Wallet authentication failed" });
        }
        const { state, slot } = await loadMatch(body.match, body.wallet);
        const entry = store.issueChallenge(body.match, body.wallet,
          slot.attemptsUsed + 1, state.endsAt.toNumber());
        return send(res, 200, {
          id: entry.id, match: entry.match, wallet: entry.wallet,
          attemptIndex: entry.attemptIndex, nonce: String(entry.nonce),
          expiresAt: entry.expiresAt, targetMs: TARGET_MS,
        });
      }
      if (req.url === "/attempt") {
        checkKeys(body, ["id", "press"]);
        if (body.press !== true) throw new Error("A press action is required");
        const entry = store.consumeChallenge(body.id);
        limit(`wallet:${entry.wallet}`, 12);
        const { game, player, slot } = await loadMatch(entry.match, entry.wallet);
        if (slot.attemptsUsed + 1 !== entry.attemptIndex) {
          throw new Error("Attempt state changed; request a new challenge");
        }
        const score = scoreTiming(entry.elapsedMs);
        const instruction = await program.methods.submitVerifiedAttempt(
          entry.attemptIndex, new BN(String(entry.nonce)), score, new BN(entry.expiresAt),
        ).accountsPartial({ game, player, verifier: verifier.publicKey }).instruction();
        const { blockhash } = await er.getLatestBlockhash("confirmed");
        const tx = new web3.Transaction({ feePayer: player, recentBlockhash: blockhash }).add(instruction);
        tx.partialSign(verifier);
        return send(res, 200, {
          score, attemptIndex: entry.attemptIndex, expiresAt: entry.expiresAt,
          transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        });
      }
      return send(res, 404, { error: "Unknown endpoint" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const status = message.includes("Rate limit") ? 429 : 400;
      send(res, status, { error: message });
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keyPath = process.env.VERIFIER_KEYPAIR_PATH;
  if (!keyPath) throw new Error("VERIFIER_KEYPAIR_PATH is required");
  const bytes = JSON.parse(await readFile(keyPath, "utf8"));
  const verifier = web3.Keypair.fromSecretKey(Uint8Array.from(bytes));
  const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
  const server = createVerifierServer({
    idl, verifier, erUrl: process.env.ER_RPC_URL ?? "http://127.0.0.1:7799",
    allowedOrigin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000",
  });
  server.listen(Number(process.env.VERIFIER_PORT ?? 8787), "127.0.0.1", () => {
    process.stdout.write("Verifier listening on 127.0.0.1\n");
  });
}
