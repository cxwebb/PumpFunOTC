"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useApi } from "@/client/hooks";
import type { OrderRow, TradeRow } from "@/client/types";
import { formatSol } from "@/lib/amounts";
import { isPublicKey } from "@/lib/validation";
import { OrderTable } from "../OrderTable";
import { Empty, Loading, Notice, Panel, short, timeAgo } from "../ui";
import { CreateOfferForm } from "./CreateOfferForm";

export function OtcDesk() {
  const params = useSearchParams();
  const initialMint = params.get("mint") ?? "";
  const { publicKey } = useWallet();
  const [mintFilter, setMintFilter] = useState(initialMint);
  const [side, setSide] = useState<"" | "sell" | "buy">("");
  const qs = new URLSearchParams({ status: "open" });
  if (isPublicKey(mintFilter)) qs.set("mint", mintFilter);
  if (side) qs.set("side", side);
  const book = useApi<{ orders: OrderRow[] }>(`/api/otc/orders?${qs}`, { pollMs: 10_000 });
  const mine = useApi<{ orders: OrderRow[] }>(publicKey ? `/api/otc/orders?status=all&involving=${publicKey.toBase58()}` : null, { pollMs: 15_000 });
  const trades = useApi<{ trades: TradeRow[] }>("/api/otc/trades?limit=10", { pollMs: 30_000 });

  const asks = (book.data?.orders ?? []).filter((o) => o.side === "sell");
  const bids = (book.data?.orders ?? []).filter((o) => o.side === "buy");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">OTC Desk</h1>
        <p className="text-dim">Escrowless block trades. Both wallets sign one transaction; tokens and SOL move together or not at all.</p>
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Panel
            title="Order book"
            right={
              <div className="flex gap-2">
                <input className="input !py-1 !w-56 text-xs" placeholder="Filter by mint" value={mintFilter} onChange={(e) => setMintFilter(e.target.value.trim())} />
                <select className="input !py-1 !w-24 text-xs" value={side} onChange={(e) => setSide(e.target.value as "" | "sell" | "buy")}>
                  <option value="">All</option>
                  <option value="sell">Asks</option>
                  <option value="buy">Bids</option>
                </select>
              </div>
            }
          >
            {book.error ? (
              <Notice tone="error">{book.error}</Notice>
            ) : book.loading && !book.data ? (
              <Loading />
            ) : (
              <div className="space-y-6">
                {side !== "buy" && (
                  <div>
                    <h3 className="text-down text-xs mb-2">ASKS · makers selling</h3>
                    <OrderTable orders={asks} empty="No open asks." />
                  </div>
                )}
                {side !== "sell" && (
                  <div>
                    <h3 className="text-up text-xs mb-2">BIDS · makers buying</h3>
                    <OrderTable orders={bids} empty="No open bids." />
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Your offers and negotiations">
            {!publicKey ? (
              <Empty>Connect a wallet to see your offers.</Empty>
            ) : mine.error ? (
              <Notice tone="warn">{mine.error}</Notice>
            ) : mine.loading && !mine.data ? (
              <Loading />
            ) : (
              <OrderTable orders={mine.data?.orders ?? []} empty="You have no offers yet." />
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Create offer">
            <CreateOfferForm defaultMint={initialMint} />
          </Panel>
          <Panel title="Recent settled trades">
            {trades.error ? (
              <Notice tone="warn">{trades.error}</Notice>
            ) : !trades.data?.trades.length ? (
              <Empty>No settled trades yet.</Empty>
            ) : (
              <ul className="space-y-2 text-xs">
                {trades.data.trades.map((t) => (
                  <li key={t.tx_signature} className="flex justify-between gap-2">
                    <a href={`/receipt/${t.tx_signature}`} className="hover:text-up">
                      {short(t.mint)} · {formatSol(BigInt(t.gross_lamports), 3)} SOL
                    </a>
                    <span className="text-dim">{timeAgo(t.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

