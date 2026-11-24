"use client";

import { useCallback, useEffect, useState } from "react";
import { base, er, fetchMatch, friendlyError, type Match } from "@/lib/chain";
import { PublicKey } from "@solana/web3.js";

export function useMatch(id: string) {
  const [state, setState] = useState<Match | null>(null);
  const [layer, setLayer] = useState<"ER" | "Solana" | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const latest = await fetchMatch(id);
      setState(latest.state);
      setLayer(latest.layer);
      setError("");
      setUpdatedAt(Date.now());
    } catch (cause) {
      setError(`${friendlyError(cause)} Showing the last confirmed snapshot until reconnect.`);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const key = (() => { try { return new PublicKey(id); } catch { return null; } })();
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2_000);
    const reconnect = () => void refresh();
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    let baseSubscription: number | undefined;
    let erSubscription: number | undefined;
    if (key) {
      baseSubscription = base.onAccountChange(key, reconnect, "confirmed");
      erSubscription = er.onAccountChange(key, reconnect, "confirmed");
    }
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(initial);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
      if (baseSubscription !== undefined) void base.removeAccountChangeListener(baseSubscription);
      if (erSubscription !== undefined) void er.removeAccountChangeListener(erSubscription);
    };
  }, [id, refresh]);

  return { state, layer, error, updatedAt, refresh };
}
