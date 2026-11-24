"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export function Header({ match }: { match?: string }) {
  const { publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  return <header className="site-header shell">
    <Link href="/" className="brand" aria-label="Meme Wars home"><span className="brand-mark">MW</span><span>MEME WARS<span className="brand-muted"> / ARENA</span></span></Link>
    <nav aria-label="Main navigation" className="nav"><Link href="/">Lobby</Link>{match && <><Link href={`/arena/${match}`}>Arena</Link><Link href={`/results/${match}`}>Results</Link></>}</nav>
    <div className="wallet-area">{publicKey ? <><span className="wallet-address" title={publicKey.toBase58()}>{publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}</span><button className="wallet-control" onClick={() => void disconnect()}>Disconnect</button></> : <button className="wallet-control" onClick={() => setVisible(true)}>Connect wallet</button>}</div>
  </header>;
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "frog" | "cat" | "alert" }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Notice({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "error" }) {
  return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Footer() {
  return <footer className="shell footer"><span>MEME WARS ARENA</span><span>Virtual credits and shares have no cash value or redemption.</span></footer>;
}
