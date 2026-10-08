"use client";

import Link from "next/link";
import { formatRaw, formatSol } from "@/lib/amounts";
import { useApi } from "@/client/hooks";
import { Addr, Loading, Notice, Panel, TxLink } from "../ui";

interface Receipt {
  signature: string;
  found: boolean;
  finalized: boolean;
  slot?: number;
  blockTime?: number | null;
  memo?: string | null;
  orderHash?: string | null;
  settlementId?: string | null;
  recorded: boolean;
  verified: boolean;
  errors: string[];
  terms?: Record<string, string | number>;
  deltas?: Record<string, string>;
}

export function ReceiptView({ signature }: { signature: string }) {
  const { data, error, loading } = useApi<{ receipt: Receipt }>(`/api/receipts/${signature}`);
  if (loading && !data) return <Loading label="Reading the transaction from Solana" />;
  if (error || !data) return <Notice tone="error">{error ?? "Receipt unavailable"}</Notice>;
  const r = data.receipt;
  const t = r.terms;
  const dec = Number(t?.decimals ?? 0);
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Settlement receipt</h1>
        <p className="text-dim text-xs">Rebuilt from the chain each time you open it. Nothing here is taken from a client claim.</p>
      </div>
      {r.verified ? (
        <Notice tone="ok">
          ✓ Verified: the {r.finalized ? "finalized" : "confirmed"} transaction is the exact message both parties agreed to, and the balance changes match the trade.
        </Notice>
      ) : (
        <Notice tone={r.found ? "warn" : "error"}>
          Not verified.
          <ul className="list-disc ml-4">
            {r.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Panel title="Transaction">
        <dl className="space-y-2">
          <Row k="Signature" v={<TxLink sig={r.signature} />} />
          {r.slot !== undefined && <Row k="Slot" v={r.slot} />}
          {r.blockTime ? <Row k="Time" v={new Date(r.blockTime * 1000).toLocaleString()} /> : null}
          <Row k="Commitment" v={r.finalized ? "finalized" : "confirmed (not yet finalized)"} />
          {r.memo && <Row k="Memo" v={<span className="break-all text-[11px]">{r.memo}</span>} />}
          {r.orderHash && <Row k="Order" v={<Link className="text-info" href={`/offer/${r.orderHash}`}>{r.orderHash.slice(0, 16)}…</Link>} />}
        </dl>
      </Panel>
      {t && r.deltas && (
        <Panel title="Transfers">
          <dl className="space-y-2">
            <Row k="Seller" v={<Addr value={String(t.seller)} />} />
            <Row k="Buyer" v={<Addr value={String(t.buyer)} />} />
            <Row k="Token" v={<Addr value={String(t.mint)} />} />
            <Row k="Tokens to buyer" v={`${formatRaw(BigInt(r.deltas.tokenDeltaBuyer), dec)} (agreed ${formatRaw(BigInt(String(t.tokenAmount)), dec)})`} />
            <Row k="SOL to seller" v={`${formatSol(BigInt(r.deltas.lamportDeltaSeller))} (agreed ${formatSol(BigInt(String(t.sellerNetLamports)))})`} />
            <Row k={`Platform fee (${Number(t.feeBps) / 100}%)`} v={`${formatSol(BigInt(r.deltas.lamportDeltaTreasury))} SOL to `} extra={<Addr value={String(t.treasury)} />} />
            <Row k="Gross price" v={`${formatSol(BigInt(String(t.grossLamports)))} SOL`} />
            <Row k="Network fee (buyer)" v={`${formatSol(BigInt(r.deltas.networkFeeLamports))} SOL`} />
          </dl>
        </Panel>
      )}
    </div>
  );
}

function Row({ k, v, extra }: { k: string; v: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/50 py-1">
      <dt className="text-dim">{k}</dt>
      <dd className="text-right">
        {v}
        {extra}
      </dd>
    </div>
  );
}
