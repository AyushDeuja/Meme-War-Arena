"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { Transaction } from "@solana/web3.js";
import { er, friendlyError, sendGameAction, VERIFIER_URL, type Match, type Player } from "@/lib/chain";
import { formatShares, minOutput, parseShares, quoteBuy, quoteSell, spotPrice } from "@/lib/market";
import { useMatch } from "./match-data";
import { Footer, Header, Notice, Tag } from "./ui";

const names = ["Frog King", "Cat Boss"];
const slippageOptions = [50n, 100n, 300n];
function short(value: string) { return `${value.slice(0, 5)}…${value.slice(-4)}`; }
function amount(value: BN) { return BigInt(value.toString()); }
function myPlayer(state: Match, wallet?: string): Player | undefined { return state.players.slice(0, state.playerCount).find((player) => player.wallet.toBase58() === wallet); }
function remaining(endsAt: BN, now: number) { return Math.min(90, Math.max(0, Math.ceil((Number(endsAt.toString()) * 1000 - now) / 1000))); }

async function post(route: string, body: object) {
  const response = await fetch(`${VERIFIER_URL}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Verifier request failed");
  return data;
}

function MarketCard({ state, player, pool, onTrade, busy, now }: { state: Match; player?: Player; pool: number; onTrade: (pool: number, side: "buy" | "sell", input: bigint, minimum: bigint) => Promise<void>; busy: boolean; now: number }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  const [slippage, setSlippage] = useState(100n);
  const credits = amount(state.creditReserves[pool]);
  const shares = amount(state.shareReserves[pool]);
  const parsed = useMemo(() => {
    try {
      const quantity = side === "buy" ? (/^[1-9]\d*$/.test(input) ? BigInt(input) : 0n) : (input ? parseShares(input) : 0n);
      if (quantity === 0n) return null;
      const output = side === "buy" ? quoteBuy(credits, shares, quantity).output : quoteSell(credits, shares, quantity).output;
      return { quantity, output, minimum: minOutput(output, slippage), error: "" };
    } catch (error) { return { quantity: 0n, output: 0n, minimum: 0n, error: friendlyError(error) }; }
  }, [credits, shares, input, side, slippage]);
  const balance = player ? side === "buy" ? amount(player.credits) : amount(pool === 0 ? player.frogShares : player.catShares) : 0n;
  const enough = parsed && !parsed.error && parsed.quantity <= balance;
  return <article className={`market-card panel ${pool === 0 ? "frog" : "cat"}`}>
    <div className="market-heading"><div className="meme-avatar">{pool === 0 ? "F" : "C"}</div><div><Tag tone={pool === 0 ? "frog" : "cat"}>POOL 0{pool + 1}</Tag><h3>{names[pool]}</h3></div><div className="price"><b>{spotPrice(credits, shares)}</b><span>credits / share</span></div></div>
    <div className="market-meta"><span>Pool liquidity</span><strong>{credits.toString()} credits</strong></div>
    <div className="segmented" role="group" aria-label={`${names[pool]} trade direction`}><button aria-pressed={side === "buy"} className={side === "buy" ? "active" : ""} onClick={() => { setSide("buy"); setInput(""); }}>Buy</button><button aria-pressed={side === "sell"} className={side === "sell" ? "active" : ""} onClick={() => { setSide("sell"); setInput(""); }}>Sell</button></div>
    <label className="field-label" htmlFor={`trade-${pool}`}>{side === "buy" ? "Credits to spend" : "Shares to sell"}<span>Available: {side === "buy" ? balance.toString() : formatShares(balance)}</span></label>
    <input id={`trade-${pool}`} inputMode="decimal" value={input} onChange={(event) => setInput(event.target.value)} placeholder={side === "buy" ? "1–250" : "1–100"} />
    <div className="quote"><span>Estimated receive</span><strong>{parsed && !parsed.error ? side === "buy" ? `${formatShares(parsed.output)} shares` : `${parsed.output} credits` : "—"}</strong></div>
    <div className="slippage"><span>Max slippage</span><select value={String(slippage)} onChange={(event) => setSlippage(BigInt(event.target.value))} aria-label="Maximum slippage">{slippageOptions.map((value) => <option key={String(value)} value={String(value)}>{Number(value) / 100}%</option>)}</select></div>
    <p className="quote-note">Minimum received: {parsed && !parsed.error ? side === "buy" ? `${formatShares(parsed.minimum)} shares` : `${parsed.minimum} credits` : "—"}</p>
    {parsed?.error && <p className="input-error">{parsed.error}</p>}
    <button className="button button-primary trade-button" disabled={busy || !player || !enough || parsed?.minimum === 0n || state.status !== 1 || remaining(state.endsAt, now) === 0} onClick={async () => { if (parsed && !parsed.error) { await onTrade(pool, side, parsed.quantity, parsed.minimum); setInput(""); } }}>{side === "buy" ? "Buy" : "Sell"} {names[pool]}</button>
    {!enough && parsed && !parsed.error && <p className="input-error">Insufficient {side === "buy" ? "credits" : "shares"}.</p>}
  </article>;
}

export function Arena({ id }: { id: string }) {
  const wallet = useWallet();
  const { state, layer, error, updatedAt, refresh } = useMatch(id);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; start: number; target: number } | null>(null);
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(interval); }, []);
  const player = state ? myPlayer(state, wallet.publicKey?.toBase58()) : undefined;
  const left = state && state.status === 1 ? remaining(state.endsAt, now) : 0;
  const canPlay = !!(state?.status === 1 && left > 0 && player?.team && player.attemptsUsed < 3 && !error);
  const status = state ? ["Registration", "Live", "Finishing", "Finalized"][state.status] : "Connecting";
  async function action(label: string, work: () => Promise<string>) {
    setBusy(true); setFailure(""); setMessage(`${label} pending wallet confirmation…`);
    try { const signature = await work(); setMessage(`${label} confirmed · ${short(signature)}`); await refresh(); }
    catch (cause) { setMessage(""); setFailure(friendlyError(cause)); }
    finally { setBusy(false); }
  }
  async function trade(pool: number, side: "buy" | "sell", input: bigint, minimum: bigint) {
    if (!player) return;
    await action(`${side === "buy" ? "Buy" : "Sell"} ${names[pool]}`, () => sendGameAction(wallet, id, (program, key) => side === "buy"
      ? program.methods.buyShares(pool, new BN(input.toString()), new BN(minimum.toString()), player.tradeNonce).accountsPartial({ game: key, player: wallet.publicKey! }).transaction()
      : program.methods.sellShares(pool, new BN(input.toString()), new BN(minimum.toString()), player.tradeNonce).accountsPartial({ game: key, player: wallet.publicKey! }).transaction()));
  }
  async function beginChallenge() {
    if (!wallet.publicKey || !wallet.signMessage || !canPlay) { setFailure("This wallet must support message signing to play the timing challenge."); return; }
    setBusy(true); setFailure("");
    try {
      const match = id; const address = wallet.publicKey.toBase58();
      const auth = await post("/auth/nonce", { match, wallet: address });
      const signed = await wallet.signMessage(new TextEncoder().encode(auth.message));
      const signature = btoa(Array.from(signed, (byte) => String.fromCharCode(byte)).join(""));
      const issued = await post("/challenge", { match, wallet: address, authNonce: auth.nonce, signature });
      setChallenge({ id: issued.id, start: Date.now(), target: issued.targetMs });
    } catch (cause) { setFailure(friendlyError(cause)); }
    finally { setBusy(false); }
  }
  async function press() {
    if (!challenge || !wallet.signTransaction) return;
    const current = challenge; setChallenge(null); setBusy(true); setFailure(""); setMessage("Timing result pending verification…");
    try {
      const result = await post("/attempt", { id: current.id, press: true });
      setPendingScore(result.score); setMessage(`Score ${result.score} verified; confirm the transaction in your wallet…`);
      const bytes = Uint8Array.from(atob(result.transaction), (char) => char.charCodeAt(0));
      const tx = Transaction.from(bytes);
      const signed = await wallet.signTransaction(tx);
      const signature = await er.sendRawTransaction(signed.serialize());
      setMessage(`Score ${result.score} submitted · ${short(signature)}. Waiting for confirmation…`);
      const confirmation = await er.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) throw new Error(`Scoring transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      setMessage(`Score ${result.score} confirmed · ${short(signature)}`); await refresh();
    } catch (cause) { setMessage(""); setFailure(friendlyError(cause)); }
    finally { setBusy(false); setPendingScore(null); }
  }
  const targetProgress = challenge ? Math.min(100, (now - challenge.start) / challenge.target * 100) : 0;
  return <><Header match={id} /><main className="shell arena">
    <div className="breadcrumb"><Link href="/">LOBBY</Link><span>/</span><span>ARENA {short(id)}</span><button className="text-button" onClick={() => void navigator.clipboard.writeText(window.location.href)}>Copy link</button></div>
    <div className="arena-top"><div><p className="eyebrow">THE LIVE ROOM <span className="eyebrow-line" /></p><h1>Frog King <span className="vs-inline">vs</span> Cat Boss</h1><p className="subline">Battle points come from verified play. The virtual market runs beside it.</p></div><div className="timer panel"><span>{status} · {layer || "checking"}</span><strong>{state?.status === 1 ? `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}` : state?.status === 0 ? "01:30" : "00:00"}</strong><small>{state?.status === 0 ? "Round begins when organizer starts" : state?.status === 1 ? "Time remaining" : "Round closed"}</small></div></div>
    {error && <Notice kind="error">{error} <button className="text-button" onClick={() => void refresh()}>Retry</button></Notice>}
    {message && <Notice>{message}</Notice>}{failure && <Notice kind="error">{failure}</Notice>}
    {!state ? <div className="panel loading">Loading canonical match state…</div> : <>
      <div className="scoreboard panel"><div><Tag tone="frog">FROG KING</Tag><strong>{state.teamScores[0].toString()}</strong><span>verified points</span></div><div className="score-center">SKILL<br />BATTLE</div><div><Tag tone="cat">CAT BOSS</Tag><strong>{state.teamScores[1].toString()}</strong><span>verified points</span></div></div>
      <div className="arena-grid"><div className="arena-main"><div className="section-head"><div><p className="eyebrow">THE VIRTUAL MARKET</p><h2>Trade the momentum</h2></div><span>Prices in credits / share</span></div><div className="market-grid"><MarketCard state={state} player={player} pool={0} onTrade={trade} busy={busy || !!error} now={now} /><MarketCard state={state} player={player} pool={1} onTrade={trade} busy={busy || !!error} now={now} /></div></div>
      <aside className="arena-side"><section className="panel side-panel"><p className="eyebrow">YOUR POSITION</p>{!wallet.publicKey ? <p>Connect a wallet to join. Spectators can follow every move.</p> : !player ? <><p>Join once to claim 1,000 virtual credits.</p><button className="button button-primary full" disabled={busy || state.status > 1 || (state.status === 1 && left === 0)} onClick={() => void action("Join", () => sendGameAction(wallet, id, (program, key) => program.methods.joinMatch().accountsPartial({ game: key, player: wallet.publicKey! }).transaction()))}>Join arena</button></> : <><div className="position-row"><span>Credits left</span><strong>{player.credits.toString()}</strong></div><div className="position-row"><span>Frog shares</span><strong>{formatShares(amount(player.frogShares))}</strong></div><div className="position-row"><span>Cat shares</span><strong>{formatShares(amount(player.catShares))}</strong></div><div className="position-row"><span>Team</span><strong>{player.team ? names[player.team - 1] : "Choose below"}</strong></div></>}</section>
        {player && <section className="panel side-panel"><p className="eyebrow">YOUR TEAM</p><h3>{player.team ? names[player.team - 1] : "Choose your side"}</h3><p>Team choice locks your scoring slot. Trading either meme stays open.</p>{!player.team && <div className="team-buttons"><button className="button frog-choice" disabled={busy || state.status > 1 || (state.status === 1 && left === 0)} onClick={() => void action("Choose Frog", () => sendGameAction(wallet, id, (program, key) => program.methods.chooseTeam(1).accountsPartial({ game: key, player: wallet.publicKey! }).transaction()))}>Frog King</button><button className="button cat-choice" disabled={busy || state.status > 1 || (state.status === 1 && left === 0)} onClick={() => void action("Choose Cat", () => sendGameAction(wallet, id, (program, key) => program.methods.chooseTeam(2).accountsPartial({ game: key, player: wallet.publicKey! }).transaction()))}>Cat Boss</button></div>}</section>}
        {state.status === 0 && wallet.publicKey?.equals(state.authority) && <section className="panel side-panel"><p className="eyebrow">ORGANIZER</p><h3>Ready to begin?</h3><p>Start once both teams have a registered player.</p><button className="button button-primary full" disabled={busy || !state.players.slice(0, state.playerCount).some((p) => p.team === 1) || !state.players.slice(0, state.playerCount).some((p) => p.team === 2)} onClick={() => void action("Start round", () => sendGameAction(wallet, id, (program, key) => program.methods.startMatch().accountsPartial({ game: key, authority: wallet.publicKey! }).transaction()))}>Start 90-second round</button></section>}
        <section className="panel side-panel challenge"><p className="eyebrow">THE SKILL CHALLENGE</p><h3>Hit the moment.</h3><p>Stop the meter near 1.5 seconds. Best verified attempt counts. Up to three tries.</p><div className="meter"><div className="meter-fill" style={{ width: `${targetProgress}%` }} /><span className="meter-target" /></div><div className="position-row"><span>Your best</span><strong>{player?.bestScore ?? "—"} / 100</strong></div><div className="position-row"><span>Attempts left</span><strong>{player ? 3 - player.attemptsUsed : "—"}</strong></div><button className="button button-primary full" disabled={busy || !canPlay} onClick={() => void (challenge ? press() : beginChallenge())}>{challenge ? "STOP THE METER" : "Start attempt"}</button>{pendingScore !== null && <p className="quote-note">Score {pendingScore} is pending chain confirmation.</p>}</section>
      </aside></div>
      <div className="arena-bottom"><span>Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"} · {layer}</span>{state.status >= 2 && <Link className="button button-secondary" href={`/results/${id}`}>View result →</Link>}</div>
    </>}
  </main><Footer /></>;
}
