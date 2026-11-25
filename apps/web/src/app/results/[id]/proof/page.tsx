import Link from "next/link";
import { readProof } from "@/lib/proof-service";
import { Footer, Header, Tag } from "@/components/ui";

export const instant = false;

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = await readProof(id);
  return <><Header match={id} /><main className="shell results proof-page">
    <div className="breadcrumb"><Link href={`/results/${id}`}>RESULTS</Link><span>/</span><span>PROOF</span></div>
    <p className="eyebrow">MATCH SETTLEMENT</p><h1>Onchain proof.</h1>
    <section className="panel result-section"><Tag>{proof.status.toUpperCase()}</Tag><h2>{proof.status === "verified" ? "Solana settlement verified" : proof.status === "pending" ? "Settlement pending" : "No verified receipt on this ledger"}</h2>
      <p className="result-note">Match account: <code>{id}</code></p>
      {proof.intentSignature && <p className="result-note">ER terminal intent: <code>{proof.intentSignature}</code></p>}
      {proof.baseSignature && <p className="result-note">Solana settlement transaction: <code>{proof.baseSignature}</code></p>}
      {proof.snapshotHash && <p className="result-note">Identical finalized ER and Solana account data SHA-256: <code>{proof.snapshotHash}</code></p>}
      <p className="result-note">This page checks the configured RPCs. A verified label requires a successful Solana transaction, program ownership, a finalized match, and account bytes matching the ER snapshot captured before settlement.</p>
      <Link className="button button-secondary" href={`/results/${id}`}>Back to results</Link>
    </section>
  </main><Footer /></>;
}
