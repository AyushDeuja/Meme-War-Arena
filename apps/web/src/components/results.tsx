"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { friendlyError, sendGameAction } from "@/lib/chain";
import { useMatch } from "./match-data";
import { Footer, Header, Notice, Tag } from "./ui";

export function Results({ id }: { id: string }) {
  const wallet = useWallet();
  const { state, layer, error, refresh } = useMatch(id);
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(timer); }, []);
  async function finish(kind: "close" | "finalize") {
    setPending(kind === "close" ? "Closing expired round…" : "Finalizing verified scores…"); setFailure(""); setDone("");
    try {
      const signature = await sendGameAction(wallet, id, (program, key) => kind === "close"
        ? program.methods.closeMatch().accountsPartial({ game: key, caller: wallet.publicKey! }).transaction()
        : program.methods.finalizeMatch().accountsPartial({ game: key, caller: wallet.publicKey! }).transaction());
      setDone(`Confirmed on ER · ${signature.slice(0, 7)}…`); await refresh();
    } catch (cause) { setFailure(friendlyError(cause)); }
    finally { setPending(""); }
  }
  const expired = state && state.status === 1 && Number(state.endsAt.toString()) * 1000 <= now;
  const outcome = state?.outcome === 1 ? "Frog King wins" : state?.outcome === 2 ? "Cat Boss wins" : state?.outcome === 3 ? "It's a draw" : "Awaiting finalization";
  return <><Header match={id} /><main className="shell results">
    <div className="breadcrumb"><Link href={`/arena/${id}`}>ARENA</Link><span>/</span><span>RESULTS</span></div>
    <p className="eyebrow">THE BATTLE RESULT</p><h1>{outcome}</h1>
    <p className="hero-lead">The winner is determined by registered players’ verified skill scores. Virtual share prices do not decide the battle.</p>
    {error && <Notice kind="error">{error} <button className="text-button" onClick={() => void refresh()}>Retry</button></Notice>}
    {failure && <Notice kind="error">{failure}</Notice>}{pending && <Notice>{pending}</Notice>}{done && <Notice>{done}</Notice>}
    {state ? <><div className="results-grid"><div className="panel result-card"><Tag tone="frog">FROG KING</Tag><strong>{state.teamScores[0].toString()}</strong><span>verified points</span></div><div className="panel result-card"><Tag tone="cat">CAT BOSS</Tag><strong>{state.teamScores[1].toString()}</strong><span>verified points</span></div></div>
      <section className="panel result-detail"><div><p className="eyebrow">ONCHAIN MATCH STATUS</p><h2>{["Registration open", "Round live", "Awaiting finalization", "Battle finalized"][state.status]}</h2><p>{layer === "Solana" && state.status === 3 ? "Final state is settled on Solana." : layer === "ER" && state.status === 3 ? "Battle result is final on ER; base settlement is pending." : "The result will appear once the round is closed and finalized."}</p></div><div className="result-actions"><Tag>{layer || "Checking"}</Tag>{expired && <button className="button button-primary" disabled={!wallet.publicKey || !!pending} onClick={() => void finish("close")}>Close expired round</button>}{state.status === 2 && <button className="button button-primary" disabled={!wallet.publicKey || !!pending} onClick={() => void finish("finalize")}>Finalize battle</button>}<Link className="button button-secondary" href={`/arena/${id}`}>Back to arena</Link></div></section>
      <p className="tiny-muted">Final score uses each team’s registered best attempts, then perfect attempts as the tie-break. Portfolio rankings arrive in Phase 8.</p>
    </> : <div className="panel loading">Reading match state…</div>}
  </main><Footer /></>;
}
