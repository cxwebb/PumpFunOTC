"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { computeFee, formatRaw, formatSol, impliedUnitPriceSol, parseUiAmount } from "@/lib/amounts";
import { APP_DOMAIN, CLUSTER, OTC_FEE_BPS, OTC_TREASURY } from "@/lib/config";
import { base58, randomHex } from "@/lib/encoding";
import { isPublicKey } from "@/lib/validation";
import { type Order, orderHash, orderSchema, orderSigningMessage } from "@/modules/otc/orders/order";
import { api } from "@/client/api";
import { useAuth } from "@/client/auth";
import type { OrderRow } from "@/client/types";
import { Notice } from "../ui";

const EXPIRIES = [
  { label: "1 hour", s: 3600 },
  { label: "6 hours", s: 6 * 3600 },
  { label: "24 hours", s: 86400 },
  { label: "3 days", s: 3 * 86400 },
  { label: "7 days", s: 7 * 86400 },
];

interface TokenChain {
  chain: { found: boolean; error?: string; safety: { ok: boolean; reasons: string[]; tokenProgram: string; decimals: number } | null; metadata: { symbol: string } | null };
}

export function CreateOfferForm({ defaultMint = "", parent }: { defaultMint?: string; parent?: OrderRow }) {
  const router = useRouter();
  const { publicKey, signMessage } = useWallet();
  const { signedIn, signIn } = useAuth();
  const [side, setSide] = useState<"sell" | "buy">(parent ? (parent.side === "sell" ? "buy" : "sell") : "sell");
  const [mint, setMint] = useState(parent?.mint ?? defaultMint);
  const [amount, setAmount] = useState(parent ? formatRaw(BigInt(parent.token_amount), parent.decimals).replace(/,/g, "") : "");
  const [totalSol, setTotalSol] = useState(parent ? formatSol(BigInt(parent.lamports)).replace(/,/g, "") : "");
  const [counterparty, setCounterparty] = useState(parent?.maker ?? "");
  const [expiry, setExpiry] = useState(86400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decimals, setDecimals] = useState<number | null>(parent?.decimals ?? null);

  const preview = useMemo(() => {
    try {
      if (decimals === null) return null;
      const tok = parseUiAmount(amount, decimals);
      const lam = parseUiAmount(totalSol, 9);
      if (tok === 0n || lam === 0n) return null;
      const fee = computeFee(lam, OTC_FEE_BPS);
      return { tok, lam, fee, unit: impliedUnitPriceSol(lam, tok, decimals) };
    } catch {
      return null;
    }
  }, [amount, totalSol, decimals]);

  const disabledReason = !OTC_TREASURY
    ? "OTC is disabled until NEXT_PUBLIC_OTC_TREASURY is configured."
    : !publicKey
      ? "Connect a wallet to create an offer."
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!publicKey || !signMessage) return setError("Connect a wallet that can sign messages");
    setBusy(true);
    try {
      if (!signedIn) await signIn();
      if (!isPublicKey(mint)) throw new Error("Enter a valid token mint address");
      if (counterparty && !isPublicKey(counterparty)) throw new Error("Counterparty must be a valid wallet address");
      const info = await api<TokenChain>(`/api/tokens/${mint}`);
      const safety = info.chain.safety;
      if (!info.chain.found || !safety) throw new Error(`Token not found on ${CLUSTER}: ${info.chain.error ?? ""}`);
      if (!safety.ok) throw new Error(`Token not supported for OTC: ${safety.reasons.join("; ")}`);
      setDecimals(safety.decimals);
      const order: Order = orderSchema.parse({
        version: 1,
        domain: APP_DOMAIN,
        network: CLUSTER,
        side,
        maker: publicKey.toBase58(),
        counterparty: counterparty || null,
        mint,
        tokenProgram: safety.tokenProgram,
        decimals: safety.decimals,
        tokenAmount: parseUiAmount(amount, safety.decimals).toString(),
        lamports: parseUiAmount(totalSol, 9).toString(),
        feeBps: OTC_FEE_BPS,
        treasury: OTC_TREASURY,
        partialFill: "none",
        parentHash: parent?.hash ?? null,
        expiresAt: Math.floor(Date.now() / 1000) + expiry,
        nonce: randomHex(16),
      });
      const sig = await signMessage(new TextEncoder().encode(orderSigningMessage(order)));
      await api("/api/otc/orders", { method: "POST", json: { order, signature: base58.encode(sig) } });
      router.push(`/offer/${orderHash(order)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {!parent && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-bg rounded border border-line">
          {(["sell", "buy"] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSide(s)}
              className={`py-1.5 rounded text-xs font-semibold ${side === s ? (s === "sell" ? "bg-down/20 text-down" : "bg-up/20 text-up") : "text-dim"}`}
            >
              {s === "sell" ? "ASK · sell tokens" : "BID · buy tokens"}
            </button>
          ))}
        </div>
      )}
      {parent && (
        <Notice tone="info">
          Counteroffer: you will {side === "sell" ? "sell" : "buy"} this token to/from the maker. It replaces their offer as the newest revision.
        </Notice>
      )}
      <div>
        <label className="label">Token mint</label>
        <input className="input" value={mint} onChange={(e) => setMint(e.target.value.trim())} disabled={!!parent} placeholder="Token mint address" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Token amount</label>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000000" />
        </div>
        <div>
          <label className="label">Total price (SOL)</label>
          <input className="input" inputMode="decimal" value={totalSol} onChange={(e) => setTotalSol(e.target.value)} placeholder="1.5" />
        </div>
      </div>
      {!parent && (
        <div>
          <label className="label">Private counterparty (optional)</label>
          <input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value.trim())} placeholder="Leave empty for a public offer" />
        </div>
      )}
      <div>
        <label className="label">Expires in</label>
        <select className="input" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
          {EXPIRIES.map((x) => (
            <option key={x.s} value={x.s}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      {preview && (
        <div className="text-xs border border-line rounded p-3 space-y-1">
          <Row k="Implied price" v={`${preview.unit} SOL / token`} />
          <Row k="Gross" v={`${formatSol(preview.lam)} SOL`} />
          <Row k={`Platform fee (${OTC_FEE_BPS / 100}%) from seller`} v={`${formatSol(preview.fee)} SOL`} />
          <Row k="Seller receives" v={`${formatSol(preview.lam - preview.fee)} SOL`} />
          <Row k="Buyer pays" v={`${formatSol(preview.lam)} SOL + network fee (+ token account rent if new)`} />
        </div>
      )}
      {decimals === null && mint && <p className="text-dim text-[11px]">Decimals are read from the mint when you submit.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {disabledReason && <Notice tone="warn">{disabledReason}</Notice>}
      <button className={`btn w-full ${side === "sell" ? "btn-down" : "btn-up"}`} disabled={busy || !!disabledReason}>
        {busy ? "Waiting for wallet…" : parent ? "Sign counteroffer" : "Sign offer"}
      </button>
      <p className="text-dim text-[11px]">Signing is free and moves no funds. Your assets stay in your wallet until a settlement you sign lands.</p>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-dim">{k}</span>
      <span>{v}</span>
    </div>
  );
}
