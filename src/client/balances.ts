"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface Holding {
  mint: string;
  amount: bigint;
  decimals: number;
  tokenProgram: string;
  account: string;
}

/** SOL and SPL/Token-2022 balances for the connected wallet, read straight from RPC. */
export function useHoldings(refreshMs = 20_000) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<bigint | null>(null);
  const [tokens, setTokens] = useState<Holding[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) return;
    try {
      const [lamports, a, b] = await Promise.all([
        connection.getBalance(publicKey, "confirmed"),
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      ]);
      setSol(BigInt(lamports));
      const out: Holding[] = [];
      for (const [list, program] of [
        [a, TOKEN_PROGRAM_ID],
        [b, TOKEN_2022_PROGRAM_ID],
      ] as const) {
        for (const { pubkey, account } of list.value) {
          const info = account.data.parsed?.info;
          if (!info) continue;
          const amount = BigInt(info.tokenAmount.amount);
          if (amount === 0n) continue;
          out.push({ mint: info.mint, amount, decimals: info.tokenAmount.decimals, tokenProgram: program.toBase58(), account: pubkey.toBase58() });
        }
      }
      setTokens(out.sort((x, y) => (y.amount > x.amount ? 1 : -1)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    const run = () => void load();
    run();
    const id = setInterval(run, refreshMs);
    return () => clearInterval(id);
  }, [publicKey, load, refreshMs]);

  if (!publicKey) return { sol: null, tokens: [] as Holding[], error: null, loading: false, reload: load };
  return { sol, tokens, error, loading: sol === null && !error, reload: load };
}

export function tokenBalanceOf(tokens: Holding[], mint: string): Holding | undefined {
  return tokens.find((t) => t.mint === mint);
}

export { PublicKey };
