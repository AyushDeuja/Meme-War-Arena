"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { BASE_URL } from "@/lib/chain";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider endpoint={BASE_URL}>
    <WalletProvider wallets={[]} autoConnect>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>;
}
