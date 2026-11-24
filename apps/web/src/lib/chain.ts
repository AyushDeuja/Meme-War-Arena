import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, PublicKey, Transaction, type SendOptions } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idlJson from "./idl/meme_wars.json";

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || idlJson.address);
export const BASE_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "http://127.0.0.1:8899";
export const ER_URL = process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL || "http://127.0.0.1:7799";
export const VERIFIER_URL = process.env.NEXT_PUBLIC_VERIFIER_URL || "http://127.0.0.1:8787";
export const FEATURED_MATCH = process.env.NEXT_PUBLIC_MATCH_PDA || "";
export const base = new Connection(BASE_URL, "confirmed");
export const er = new Connection(ER_URL, "confirmed");
const idl = idlJson as unknown as Idl;

export type Player = {
  wallet: PublicKey; credits: BN; frogShares: BN; catShares: BN;
  team: number; bestScore: number; attemptsUsed: number; tradeNonce: BN;
  perfectAttempts: number;
};
export type Match = {
  authority: PublicKey; verifier: PublicKey; matchId: BN; status: number;
  outcome: number; startedAt: BN; endsAt: BN; finalizedAt: BN;
  creditReserves: BN[]; shareReserves: BN[]; teamScores: BN[];
  players: Player[]; playerCount: number;
};

export function validMatchId(id: string) {
  try { return new PublicKey(id).toBase58() === id; } catch { return false; }
}

export async function fetchMatch(id: string): Promise<{ state: Match; layer: "ER" | "Solana" }> {
  if (!validMatchId(id)) throw new Error("Enter a valid match address");
  if (PROGRAM_ID.toBase58() !== idlJson.address) throw new Error("Configured program does not match the bundled IDL");
  const key = new PublicKey(id);
  const account = await base.getAccountInfo(key, "confirmed");
  if (!account) throw new Error("Match not found on this Solana network. Check the RPC and address.");
  const delegated = account.owner.equals(DELEGATION_PROGRAM_ID);
  if (!delegated && !account.owner.equals(PROGRAM_ID)) throw new Error("Match has an unexpected owner on this network");
  const erAccount = delegated ? await er.getAccountInfo(key, "confirmed") : account;
  if (!erAccount || !erAccount.owner.equals(PROGRAM_ID)) throw new Error("Delegated match is not available on this ER. Check the ER endpoint.");
  const state = new Program(idl, { connection: delegated ? er : base }).coder.accounts.decode("match", erAccount.data) as Match;
  return { state, layer: delegated ? "ER" : "Solana" };
}

export async function sendGameAction(wallet: WalletContextState, id: string, build: (program: Program<Idl>, key: PublicKey) => Promise<Transaction>) {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Connect a wallet that supports transaction signing");
  const { layer } = await fetchMatch(id);
  if (layer !== "ER") throw new Error("This match is not delegated to the ER");
  const key = new PublicKey(id);
  const signer = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions || (async () => { throw new Error("Wallet cannot sign multiple transactions"); }),
  };
  const program = new Program(idl, new AnchorProvider(er, signer, { commitment: "confirmed" }));
  const tx = await build(program, key);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash("confirmed")).blockhash;
  const signed = await wallet.signTransaction(tx);
  const signature = await er.sendRawTransaction(signed.serialize(), { skipPreflight: false } as SendOptions);
  const result = await er.confirmTransaction(signature, "confirmed");
  if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  return signature;
}

export function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/user rejected|user declined|rejected the request/i.test(text)) return "Wallet request rejected. Nothing was submitted.";
  if (/InvalidNonce|SlippageExceeded/i.test(text)) return "Market moved before confirmation. Refresh the quote and try again.";
  if (/fetch|network|ECONN|failed to connect/i.test(text)) return "Connection lost. Check the local RPC and ER, then retry.";
  return text;
}
