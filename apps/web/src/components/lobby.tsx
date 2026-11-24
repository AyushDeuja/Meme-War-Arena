"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FEATURED_MATCH, validMatchId } from "@/lib/chain";
import { useMatch } from "./match-data";
import { Footer, Header, Notice, Tag } from "./ui";

export function Lobby() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const featured = useMatch(FEATURED_MATCH);
  const match = featured.state;
  const status = match ? ["Registration open", "Live now", "Finishing", "Finalized"][match.status] : "No match loaded";
  return <><Header match={FEATURED_MATCH || undefined} /><main className="shell lobby">
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">THE 90 SECOND MEME SHOWDOWN <span className="eyebrow-line" /></p>
        <h1>Pick a side.<br /><em>Make your move.</em></h1>
        <p className="hero-lead">Frog King and Cat Boss meet in one live arena. Play a timing challenge for your team. Trade virtual shares for the thrill of the market.</p>
        <div className="hero-actions">{FEATURED_MATCH && <Link className="button button-primary" href={`/arena/${FEATURED_MATCH}`}>Enter the arena <span aria-hidden>↗</span></Link>}<a className="button button-secondary" href="#how-it-works">How it works</a></div>
        <p className="tiny-muted">No real tokens. No wagers. Just a quick battle and a fictional market.</p>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="hero-ring"><span className="hero-frog">FROG<br />KING</span><b>VS</b><span className="hero-cat">CAT<br />BOSS</span></div><span className="hero-art-label">ONE ROOM / TWO MEMES / 90 SECONDS</span></div>
    </section>
    <section className="featured panel"><div><p className="eyebrow">FEATURED MATCH</p><h2>{status}</h2><p>{match ? `${match.playerCount}/10 players · ${featured.layer} state` : FEATURED_MATCH ? featured.error || "Connecting to the arena…" : "The organizer has not configured an arena yet."}</p></div>{FEATURED_MATCH && <Link className="button button-outline" href={`/arena/${FEATURED_MATCH}`}>View room →</Link>}</section>
    <section className="join-by-address panel"><div><h2>Have an arena link?</h2><p>Open a shared match address to join or watch.</p></div><form onSubmit={(event) => { event.preventDefault(); if (validMatchId(address.trim())) router.push(`/arena/${address.trim()}`); }}><label className="sr-only" htmlFor="match-address">Match address</label><input id="match-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Paste match address" /><button className="button button-secondary" disabled={!validMatchId(address.trim())}>Open</button></form></section>
    <section className="how" id="how-it-works"><p className="eyebrow">THE RULES, SIMPLIFIED</p><h2>Three moves. One winner.</h2><div className="rule-grid"><article className="panel"><Tag>01 / JOIN</Tag><h3>Claim your place</h3><p>Connect a wallet, join the room, and receive 1,000 virtual credits. Choose Frog or Cat for the skill battle.</p></article><article className="panel"><Tag tone="frog">02 / PLAY</Tag><h3>Hit the moment</h3><p>Stop the 1.5 second timing meter. You get three verified attempts; your best score counts for your team.</p></article><article className="panel"><Tag tone="cat">03 / TRADE</Tag><h3>Move the market</h3><p>Buy and sell either meme with virtual credits. Trades move prices, but verified skill scores decide the battle.</p></article></div></section>
    {!FEATURED_MATCH && <Notice>To host a local round, run the match preparation script and set NEXT_PUBLIC_MATCH_PDA in apps/web/.env.local.</Notice>}
  </main><Footer /></>;
}
