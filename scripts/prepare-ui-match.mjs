import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as anchor from "@coral-xyz/anchor";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

const { BN, AnchorProvider, Program, Wallet, web3 } = anchor.default ?? anchor;
const organizerPath = process.env.ANCHOR_WALLET;
const verifierPath = process.env.VERIFIER_KEYPAIR_PATH;
if (!organizerPath || !verifierPath) throw new Error("Set ANCHOR_WALLET and VERIFIER_KEYPAIR_PATH to private files outside this repo");

const idl = JSON.parse(await readFile("target/idl/meme_wars.json", "utf8"));
const organizer = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(organizerPath, "utf8"))));
const verifier = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(verifierPath, "utf8"))));
assert.equal(organizer.publicKey.toBase58(), "7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm", "Wrong organizer key");
const baseUrl = process.env.BASE_RPC_URL ?? "http://127.0.0.1:8899";
const erUrl = process.env.ER_RPC_URL ?? "http://127.0.0.1:7799";
const base = new web3.Connection(baseUrl, "confirmed");
const er = new web3.Connection(erUrl, "confirmed");
const programId = new web3.PublicKey(idl.address);
const deployed = await base.getAccountInfo(programId);
if (!deployed?.executable) throw new Error(`Program ${programId} is not deployed on ${baseUrl}`);
await er.getVersion();
const id = new BN(Date.now());
const [game] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("match"), organizer.publicKey.toBuffer(), id.toArrayLike(Buffer, "le", 8)], programId,
);
const program = new Program(idl, new AnchorProvider(base, new Wallet(organizer), { commitment: "confirmed" }));
const initialize = await program.methods.initializeMatch(id, verifier.publicKey)
  .accountsPartial({ game, authority: organizer.publicKey }).rpc();
console.log(`MATCH_PDA=${game}`);
console.log(`MATCH_ID=${id}`);
console.log(`BASE_INITIALIZE_SIGNATURE=${initialize}`);
const localValidator = new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");
const delegate = await program.methods.delegateMatch(id)
  .accountsPartial({ authority: organizer.publicKey, pda: game })
  .remainingAccounts([{ pubkey: localValidator, isSigner: false, isWritable: false }]).rpc();
console.log(`BASE_DELEGATE_SIGNATURE=${delegate}`);
const until = Date.now() + 45_000;
let ready = false;
while (Date.now() < until) {
  const [baseAccount, erAccount] = await Promise.all([base.getAccountInfo(game), er.getAccountInfo(game)]);
  if (baseAccount?.owner.equals(DELEGATION_PROGRAM_ID) && erAccount?.owner.equals(programId)) { ready = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error(`Delegation not visible yet. Inspect match ${game}; do not initialize a replacement blindly.`);
console.log(`Set NEXT_PUBLIC_MATCH_PDA=${game} in apps/web/.env.local, then restart Next.js.`);
