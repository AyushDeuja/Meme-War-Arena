import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BN, Program, type Idl } from "@coral-xyz/anchor";
import { DELEGATION_PROGRAM_ID, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { base, er, PROGRAM_ID, validMatchId, type Match } from "./chain";
import idlJson from "./idl/meme_wars.json";

type Receipt = {
  version: 1;
  match: string;
  erHash: string;
  intentSignature?: string;
  baseSignature?: string;
};

export type PublicProof = {
  status: "none" | "pending" | "verified" | "unavailable";
  intentSignature?: string;
  baseSignature?: string;
  snapshotHash?: string;
};

const proofDir = path.join(process.cwd(), ".proofs");
const coder = new Program(idlJson as unknown as Idl, { connection: base }).coder;
const undelegateDiscriminator = Buffer.from(idlJson.instructions.find((ix) => ix.name === "undelegate_match")!.discriminator);

function keyFor(id: string) {
  if (!validMatchId(id)) throw new Error("Invalid match address");
  return new PublicKey(id);
}

function hash(data: Buffer) { return createHash("sha256").update(data).digest("hex"); }
function filename(id: string) { keyFor(id); return path.join(proofDir, `${id}.json`); }

async function load(id: string): Promise<Receipt | null> {
  try {
    const record = JSON.parse(await readFile(filename(id), "utf8")) as Receipt;
    if (record.version !== 1 || record.match !== id || !/^[0-9a-f]{64}$/.test(record.erHash)) return null;
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function save(record: Receipt) {
  await mkdir(proofDir, { recursive: true });
  const temporary = path.join(proofDir, `${record.match}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), { flag: "wx" });
  await rename(temporary, filename(record.match));
}

async function readFinalBase(id: string, expectedHash: string, baseSignature: string) {
  const key = keyFor(id);
  const [account, transaction] = await Promise.all([
    base.getAccountInfo(key, "confirmed"),
    base.getParsedTransaction(baseSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }),
  ]);
  if (!account?.owner.equals(PROGRAM_ID) || hash(account.data) !== expectedHash) return false;
  if (!transaction?.meta || transaction.meta.err || !transaction.transaction.message.accountKeys.some((entry) => entry.pubkey.equals(key))) return false;
  const state = coder.accounts.decode("match", account.data) as Match;
  if (state.status !== 3 || state.outcome < 1 || state.outcome > 3) return false;
  const [derived] = PublicKey.findProgramAddressSync([
    Buffer.from("match"), state.authority.toBuffer(), new BN(state.matchId.toString()).toArrayLike(Buffer, "le", 8),
  ], PROGRAM_ID);
  return derived.equals(key);
}

export async function readProof(id: string): Promise<PublicProof> {
  const record = await load(id);
  if (!record) return { status: "none" };
  if (!record.baseSignature) {
    try {
      const key = keyFor(id);
      const account = await base.getAccountInfo(key, "confirmed");
      if (account?.owner.equals(PROGRAM_ID) && hash(account.data) === record.erHash) {
        return { status: "pending", intentSignature: record.intentSignature };
      }
      if (account?.owner.equals(DELEGATION_PROGRAM_ID)) {
        const erAccount = await er.getAccountInfo(key, "confirmed");
        if (erAccount?.owner.equals(PROGRAM_ID) && hash(erAccount.data) === record.erHash) {
          return { status: "pending", intentSignature: record.intentSignature };
        }
      }
    } catch { /* The current ledger cannot confirm this pending record. */ }
    return { status: "unavailable" };
  }
  try {
    if (await readFinalBase(id, record.erHash, record.baseSignature)) return {
      status: "verified", intentSignature: record.intentSignature,
      baseSignature: record.baseSignature, snapshotHash: record.erHash,
    };
  } catch { /* RPC unavailable or a stale local ledger: do not show verified proof. */ }
  return { status: "unavailable" };
}

export async function prepareProof(id: string): Promise<PublicProof> {
  const existing = await readProof(id);
  if (existing.status === "verified" || existing.status === "pending") return existing;
  const key = keyFor(id);
  const [baseAccount, erAccount] = await Promise.all([
    base.getAccountInfo(key, "confirmed"), er.getAccountInfo(key, "confirmed"),
  ]);
  if (!baseAccount?.owner.equals(DELEGATION_PROGRAM_ID) || !erAccount?.owner.equals(PROGRAM_ID)) {
    throw new Error("Match is not a delegated ER account");
  }
  const state = coder.accounts.decode("match", erAccount.data) as Match;
  if (state.status !== 3 || state.outcome < 1 || state.outcome > 3) throw new Error("Finalize the battle before settlement");
  const [derived] = PublicKey.findProgramAddressSync([
    Buffer.from("match"), state.authority.toBuffer(), new BN(state.matchId.toString()).toArrayLike(Buffer, "le", 8),
  ], PROGRAM_ID);
  if (!derived.equals(key)) throw new Error("Match PDA does not match its onchain authority and ID");
  await save({ version: 1, match: id, erHash: hash(erAccount.data) });
  return { status: "pending" };
}

export async function verifyProof(id: string, intentSignature: string): Promise<PublicProof> {
  const record = await load(id);
  if (!record) throw new Error("Prepare the finalized ER snapshot before settlement");
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(intentSignature)) throw new Error("Invalid ER signature");
  if (record.intentSignature && record.intentSignature !== intentSignature) throw new Error("A different settlement intent is already recorded");
  if (record.baseSignature) return readProof(id);
  const key = keyFor(id);
  const transaction = await er.getParsedTransaction(intentSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
  if (!transaction?.meta || transaction.meta.err) throw new Error("ER settlement intent is not confirmed");
  const isUndelegate = transaction.transaction.message.instructions.some((ix) =>
    ix.programId.equals(PROGRAM_ID) && "data" in ix && "accounts" in ix
    && ix.accounts.some((account) => account.equals(key))
    && Buffer.from(bs58.decode(ix.data)).subarray(0, 8).equals(undelegateDiscriminator));
  if (!isUndelegate) throw new Error("ER transaction is not this match's undelegation intent");
  if (!record.intentSignature) await save({ ...record, intentSignature });
  let baseSignature: string;
  try { baseSignature = await GetCommitmentSignature(intentSignature, er); }
  catch { return { status: "pending", intentSignature }; }
  if (!await readFinalBase(id, record.erHash, baseSignature)) return { status: "pending", intentSignature };
  await save({ ...record, intentSignature, baseSignature });
  return readProof(id);
}
