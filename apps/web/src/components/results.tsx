"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { friendlyError, sendGameAction } from "@/lib/chain";
import { spotPrice } from "@/lib/market";
import { rankPortfolios } from "@/lib/results";
import { useMatch } from "./match-data";
import { Footer, Header, Notice, Tag } from "./ui";

type Proof = { status: "none" | "pending" | "verified" | "unavailable"; intentSignature?: string; baseSignature?: string };
function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-6)}`; }

export function Results({ id }: { id: string }) {
  const wallet = useWallet();
  const { state, layer, error, refresh } = useMatch(id);
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [intent, setIntent] = useState("");
  const [now, setNow] = useState(0);
  const proofUrl = `/api/results/${id}/proof`;

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const savedTimer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(`meme-wars-settlement:${id}`);
      if (saved) setIntent(saved);
    }, 0);
    const check = async () => {
      try {
        const response = await fetch(proofUrl, { cache: "no-store" });
        if (response.ok) {
          const latest = await response.json() as Proof;
          setProof(latest);
          if (latest.status === "verified") window.localStorage.removeItem(`meme-wars-settlement:${id}`);
        }
      } catch { /* Match polling reports connection faults separately. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => { window.clearInterval(timer); window.clearTimeout(savedTimer); };
  }, [id, proofUrl]);

  async function proofPost(body: object): Promise<Proof> {
    const response = await fetch(proofUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Proof service unavailable");
    return data as Proof;
  }

  async function finish(kind: "close" | "finalize") {
    setPending(kind === "close" ? "Closing expired round…" : "Finalizing verified scores…"); setFailure(""); setDone("");
    try {
      const signature = await sendGameAction(wallet, id, (program, key) => kind === "close"
        ? program.methods.closeMatch().accountsPartial({ game: key, caller: wallet.publicKey! }).transaction()
        : program.methods.finalizeMatch().accountsPartial({ game: key, caller: wallet.publicKey! }).transaction());
      setDone(`Confirmed on ER · ${short(signature)}`); await refresh();
    } catch (cause) { setFailure(friendlyError(cause)); }
    finally { setPending(""); }
  }

  async function verify(signature: string) {
    setPending("Checking the ER intent and Solana settlement…"); setFailure(""); setDone("");
    try {
      const latest = await proofPost({ action: "verify", intentSignature: signature });
      setProof(latest);
      if (latest.status === "verified") {
        window.localStorage.removeItem(`meme-wars-settlement:${id}`);
        setIntent(""); setDone("Finalized account and Solana transaction verified.");
        await refresh();
      } else setDone("Settlement is still pending. Resume verification with the saved ER signature.");
    } catch (cause) { setFailure(friendlyError(cause)); }
    finally { setPending(""); }
  }

  async function settle() {
    if (intent || proof?.intentSignature) { await verify(intent || proof!.intentSignature!); return; }
    setPending("Preparing the finalized ER snapshot…"); setFailure(""); setDone("");
    try {
      const prepared = await proofPost({ action: "prepare" });
      if (prepared.status === "verified") { setProof(prepared); await refresh(); return; }
      if (prepared.intentSignature) { setIntent(prepared.intentSignature); await verify(prepared.intentSignature); return; }
      setPending("Approve terminal settlement in your wallet…");
      const signature = await sendGameAction(wallet, id,
        (program, key) => program.methods.undelegateMatch().accountsPartial({ game: key, authority: wallet.publicKey! }).transaction(),
        (signedSignature) => {
          window.localStorage.setItem(`meme-wars-settlement:${id}`, signedSignature);
          setIntent(signedSignature);
        });
      await verify(signature);
    } catch (cause) { setFailure(`${friendlyError(cause)} If your wallet signed, use Resume verification before another settlement attempt.`); }
    finally { setPending(""); }
  }

  const expired = state && state.status === 1 && Number(state.endsAt.toString()) * 1000 <= now;
  const finalized = state?.status === 3;
  const outcome = finalized ? state.outcome === 1 ? "Frog King wins" : state.outcome === 2 ? "Cat Boss wins" : state.outcome === 3 ? "It's a draw" : "Outcome unavailable" : "Awaiting finalization";
  const perfects = state?.players.slice(0, state.playerCount).reduce((totals, player) => {
    if (player.team === 1 || player.team === 2) totals[player.team - 1] += player.perfectAttempts;
    return totals;
  }, [0, 0]) ?? [0, 0];
  let ranking: ReturnType<typeof rankPortfolios> = [];
  let price: [string, string] | null = null;
  let mathError = "";
  if (finalized) {
    try {
      const credits: [bigint, bigint] = [BigInt(state.creditReserves[0].toString()), BigInt(state.creditReserves[1].toString())];
      const shares: [bigint, bigint] = [BigInt(state.shareReserves[0].toString()), BigInt(state.shareReserves[1].toString())];
      ranking = rankPortfolios(state.players.slice(0, state.playerCount).map((player) => ({
        wallet: player.wallet.toBase58(), credits: BigInt(player.credits.toString()),
        frogShares: BigInt(player.frogShares.toString()), catShares: BigInt(player.catShares.toString()),
      })), credits, shares);
      price = [spotPrice(credits[0], shares[0]), spotPrice(credits[1], shares[1])];
    } catch (cause) { mathError = friendlyError(cause); }
  }

  return <><Header match={id} /><main className="shell results">
    <div className="breadcrumb"><Link href={`/arena/${id}`}>ARENA</Link><span>/</span><span>RESULTS</span></div>
    <p className="eyebrow">THE BATTLE RESULT</p><h1>{outcome}</h1>
    <p className="hero-lead">The winner comes from verified skill scores. Virtual share prices do not decide the battle.</p>
    {error && <Notice kind="error">{error} <button className="text-button" onClick={() => void refresh()}>Retry</button></Notice>}
    {failure && <Notice kind="error">{failure}</Notice>}{mathError && <Notice kind="error">{mathError}</Notice>}
    {pending && <Notice>{pending}</Notice>}{done && <Notice>{done}</Notice>}
    {state ? <>
      <div className="results-grid">
        <div className="panel result-card"><Tag tone="frog">FROG KING</Tag><strong>{state.teamScores[0].toString()}</strong><span>verified points · {perfects[0]} perfect attempts</span></div>
        <div className="panel result-card"><Tag tone="cat">CAT BOSS</Tag><strong>{state.teamScores[1].toString()}</strong><span>verified points · {perfects[1]} perfect attempts</span></div>
      </div>
      <section className="panel result-detail"><div><p className="eyebrow">ONCHAIN MATCH STATUS</p><h2>{["Registration open", "Round live", "Awaiting finalization", "Battle finalized"][state.status]}</h2><p>{layer === "Solana" && finalized ? "Final account is owned by the program on Solana." : layer === "ER" && finalized ? "Battle finalized on ER. Solana settlement is pending." : "The result appears after the round closes and finalizes."}</p></div><div className="result-actions"><Tag>{layer || "Checking"}</Tag>{expired && <button className="button button-primary" disabled={!wallet.publicKey || !!pending} onClick={() => void finish("close")}>Close expired round</button>}{state.status === 2 && <button className="button button-primary" disabled={!wallet.publicKey || !!pending} onClick={() => void finish("finalize")}>Finalize battle</button>}{finalized && proof?.status !== "verified" && wallet.publicKey?.equals(state.authority) && (layer === "ER" || !!intent || !!proof?.intentSignature) && <button className="button button-primary" disabled={!!pending} onClick={() => void settle()}>{intent || proof?.intentSignature ? "Resume verification" : "Settle on Solana"}</button>}<Link className="button button-secondary" href={`/arena/${id}`}>Back to arena</Link></div></section>
      <p className="tiny-muted">Each team has five scoring slots; unused slots count as zero. Equal score totals use perfect-attempt counts, then draw.</p>
      {finalized && <>
        <section className="panel result-section"><p className="eyebrow">THE VIRTUAL MARKET</p><h2>Closing prices</h2><div className="closing-prices"><div><Tag tone="frog">FROG KING</Tag><strong>{price?.[0] ?? "—"}</strong><span>credits / share</span></div><div><Tag tone="cat">CAT BOSS</Tag><strong>{price?.[1] ?? "—"}</strong><span>credits / share</span></div></div></section>
        <section className="panel result-section"><p className="eyebrow">SEPARATE FROM THE BATTLE WINNER</p><h2>Indicative virtual portfolio value</h2><p className="result-note">Available credits plus each holding valued at its closing pool spot ratio. Each holding is rounded down to whole credits. This is not liquidation value: thin-pool prices can inflate the ranking. Virtual credits and shares have no cash value or payouts.</p><ol className="portfolio-list">{ranking.map((entry) => <li key={entry.wallet}><span className="portfolio-rank">#{entry.rank}</span><span className="portfolio-wallet" title={entry.wallet}>{short(entry.wallet)}</span><strong>{entry.value.toString()} credits</strong></li>)}</ol></section>
        <section className="panel result-section"><p className="eyebrow">SETTLEMENT PROOF</p><h2>{proof?.status === "verified" ? "Verified on Solana" : proof?.status === "unavailable" ? "Proof unavailable on this ledger" : "Solana settlement pending"}</h2>{proof?.status === "verified" ? <p className="result-note">ER intent: <code>{proof.intentSignature}</code><br />Solana transaction: <code>{proof.baseSignature}</code></p> : <p className="result-note">A final ER result is visible, but a matching Solana settlement receipt has not been verified yet.</p>}<Link className="button button-secondary" href={`/results/${id}/proof`}>View proof ↗</Link></section>
      </>}
    </> : <div className="panel loading">Reading match state…</div>}
  </main><Footer /></>;
}
