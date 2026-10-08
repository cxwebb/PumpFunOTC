"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { base58 } from "@/lib/encoding";
import { api } from "./api";

interface AuthState {
  /** Wallet the server session is signed in as (may differ from the connected wallet). */
  sessionWallet: string | null;
  /** True when the connected wallet is the signed-in wallet. */
  signedIn: boolean;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ wallet: string | null }>("/api/auth/me")
      .then((r) => setSessionWallet(r.wallet))
      .catch(() => setSessionWallet(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    if (!publicKey) throw new Error("Connect a wallet first");
    if (!signMessage) throw new Error("This wallet cannot sign messages");
    const wallet = publicKey.toBase58();
    try {
      const { nonce, message } = await api<{ nonce: string; message: string }>("/api/auth/challenge", { method: "POST", json: { wallet } });
      const sig = await signMessage(new TextEncoder().encode(message));
      await api("/api/auth/verify", { method: "POST", json: { wallet, nonce, signature: base58.encode(sig) } });
      setSessionWallet(wallet);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setSessionWallet(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      sessionWallet,
      signedIn: !!(connected && publicKey && sessionWallet === publicKey.toBase58()),
      loading,
      error,
      signIn,
      signOut,
    }),
    [sessionWallet, connected, publicKey, loading, error, signIn, signOut],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
