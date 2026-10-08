"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PUBLIC_RPC_URL } from "@/lib/config";
import { AuthProvider } from "@/client/auth";

export function Providers({ children }: { children: ReactNode }) {
  // Phantom, Solflare, Backpack and others register through the Wallet Standard,
  // so no per-wallet adapters are needed.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={PUBLIC_RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AuthProvider>{children}</AuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
