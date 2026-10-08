"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { formatRaw, formatSol, parseUiAmount } from "@/lib/amounts";
import { fromBase64 } from "@/lib/encoding";
import { verifyTradeTransaction } from "@/modules/trading/verify";
import { api } from "@/client/api";
import { useAuth } from "@/client/auth";
import { tokenBalanceOf, useHoldings } from "@/client/balances";
import { Notice, TxLink } from "../ui";

interface Built {
  quote: { venue: string; side: "buy" | "sell"; amountIn: string; expectedOut: string; limit: string; slippagePct: number };
  transaction: string;
  simulation: { err: unknown; unitsConsumed: number | null; logs: string[] };
}

export function TradePanel({ mint, decimals, venue }: { mint: string; decimals: number | null; venue: string | null }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { signedIn, signIn } = useAuth();
  const { sol, tokens, reload } = useHoldings();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("5");
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  const holding = tokenBalanceOf(tokens, mint);
  const tradable = venue === "curve" || venue === "pumpswap";

  async function review() {
    setError(null);
    setBuilt(null);
    setSig(null);
    setBusy("quote");
    try {
      if (!signedIn) await signIn();
      if (decimals === null) throw new Error("Token decimals unknown on this network");
      const raw = side === "buy" ? parseUiAmount(amount, 9) : parseUiAmount(amount, decimals);
      const b = await api<Built>("/api/trade/build", { method: "POST", json: { mint, side, amount: raw.toString(), slippagePct: Number(slippage) } });
      setBuilt(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!built || !publicKey) return;
    setError(null);
    setBusy("send");
    try {
      const tx = VersionedTransaction.deserialize(fromBase64(built.transaction));
      const maxOut = side === "buy" ? (BigInt(built.quote.limit) > BigInt(built.quote.amountIn) ? BigInt(built.quote.limit) : BigInt(built.quote.amountIn)) + 10_000_000n : 10_000_000n;
      const problems = verifyTradeTransaction(tx, publicKey.toBase58(), { maxLamportsOut: maxOut });
      if (problems.length) throw new Error(`Refusing to sign: ${problems.join("; ")}`);
      const signature = await sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });
      setSig(signature);
      const latest = await connection.getLatestBlockhash("confirmed");
      const res = await connection.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(res.value.err)}`);
      setBuilt(null);
      setAmount("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const outDecimals = side === "buy" ? (decimals ?? 0) : 9;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 p-1 bg-bg rounded border border-line">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setBuilt(null);
            }}
            className={`py-1.5 rounded text-xs font-semibold ${side === s ? (s === "buy" ? "bg-up/20 text-up" : "bg-down/20 text-down") : "text-dim"}`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      {!tradable && <Notice tone="warn">No Pump.fun curve or PumpSwap pool for this token on the current network, so spot trading is unavailable here.</Notice>}
      <div>
        <label className="label">{side === "buy" ? "Spend (SOL)" : "Sell (tokens)"}</label>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setBuilt(null))} placeholder="0.0" />
        <div className="text-[11px] text-dim mt-1 flex justify-between">
          <span>
            Balance: {side === "buy" ? (sol !== null ? `${formatSol(sol, 4)} SOL` : "—") : holding ? formatRaw(holding.amount, holding.decimals, 4) : "0"}
          </span>
          {side === "sell" && holding && (
            <button className="text-info" onClick={() => setAmount(formatRaw(holding.amount, holding.decimals).replace(/,/g, ""))}>
              max
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="label">Slippage %</label>
        <input className="input" inputMode="decimal" value={slippage} onChange={(e) => (setSlippage(e.target.value), setBuilt(null))} />
      </div>
      {!built ? (
        <button className="btn w-full" disabled={!publicKey || !tradable || !amount || !!busy} onClick={review}>
          {busy === "quote" ? "Quoting and simulating…" : "Review trade"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-xs border border-line rounded p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-dim">Venue</span>
              <span>{built.quote.venue === "curve" ? "Pump.fun bonding curve" : "PumpSwap"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dim">Expected</span>
              <span>
                {formatRaw(BigInt(built.quote.expectedOut), outDecimals, 6)} {side === "buy" ? "tokens" : "SOL"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dim">{side === "buy" && built.quote.venue === "pumpswap" ? "Max SOL spent" : "Minimum received"}</span>
              <span>
                {side === "buy" && built.quote.venue === "pumpswap" ? `${formatSol(BigInt(built.quote.limit), 6)} SOL` : `${formatRaw(BigInt(built.quote.limit), outDecimals, 6)} ${side === "buy" ? "tokens" : "SOL"}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dim">Simulation</span>
              <span className="text-up">passed{built.simulation.unitsConsumed ? ` · ${built.simulation.unitsConsumed} CU` : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dim">Platform fee</span>
              <span>none (Pump protocol fees apply)</span>
            </div>
          </div>
          <button className={`btn w-full ${side === "buy" ? "btn-up" : "btn-down"}`} disabled={!!busy} onClick={confirm}>
            {busy === "send" ? "Confirm in wallet…" : `Confirm ${side}`}
          </button>
          <button className="btn w-full text-xs" onClick={() => setBuilt(null)}>
            Back
          </button>
        </div>
      )}
      {sig && (
        <Notice tone="ok">
          Sent: <TxLink sig={sig} />
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
