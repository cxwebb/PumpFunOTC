"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/client/hooks";
import type { OrderRow } from "@/client/types";
import type { MarketToken } from "@/modules/market-data/types";
import { isPublicKey } from "@/lib/validation";
import { OrderTable } from "../OrderTable";
import { Empty, Loading, Notice, Panel, TokenLink, fmtPct, fmtUsd, timeAgo } from "../ui";

interface ExploreData {
  trending: MarketToken[];
  newLaunches: MarketToken[];
  nearGraduation: MarketToken[];
  graduated: MarketToken[];
  errors: string[];
}
interface Launch {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  confirmed_at: string;
}

const TABS = [
  { key: "trending", label: "Trending" },
  { key: "newLaunches", label: "New Pump launches" },
  { key: "nearGraduation", label: "Bonding curve" },
  { key: "graduated", label: "Graduated (PumpSwap)" },
] as const;

export function Explore() {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("trending");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const market = useApi<ExploreData>("/api/market/explore", { pollMs: 60_000 });
  const searchRes = useApi<{ results: MarketToken[] }>(submitted ? `/api/market/search?q=${encodeURIComponent(submitted)}` : null);
  const offers = useApi<{ orders: OrderRow[] }>("/api/otc/orders?status=open", { pollMs: 15_000 });
  const launches = useApi<{ launches: Launch[] }>("/api/launches");

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return setSubmitted(null);
    if (isPublicKey(v)) return router.push(`/token/${v}`);
    setSubmitted(v);
  };

  const list = submitted ? (searchRes.data?.results ?? []) : (market.data?.[tab] ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h1 className="text-xl font-bold">Explore</h1>
          <p className="text-dim">Pump.fun tokens, live OTC offers and coins launched here.</p>
        </div>
        <form onSubmit={onSearch} className="flex gap-2 w-full md:w-[420px]">
          <input className="input" placeholder="Search name, symbol or paste a mint address" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">Search</button>
        </form>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Panel
          className="lg:col-span-2"
          title={
            submitted ? (
              <span>
                Results for “{submitted}” <button className="ml-2 text-info normal-case" onClick={() => setSubmitted(null)}>clear</button>
              </span>
            ) : (
              <div className="flex flex-wrap gap-1 normal-case tracking-normal">
                {TABS.map((t) => (
                  <button key={t.key} onClick={() => setTab(t.key)} className={`px-2 py-1 rounded text-xs ${tab === t.key ? "bg-panel-2 text-ink" : "text-dim hover:text-ink"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            )
          }
          right={<span className="text-[10px] text-dim">Market data: Solana mainnet · DexScreener</span>}
        >
          {market.error && !submitted && <Notice tone="error">Market data unavailable: {market.error}</Notice>}
          {market.data?.errors?.length ? <Notice tone="warn">Some lists failed to load: {market.data.errors.join("; ")}</Notice> : null}
          {(submitted ? searchRes.loading : market.loading) && !list.length ? (
            <Loading />
          ) : list.length === 0 ? (
            <Empty>No tokens to show.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">24h</th>
                    <th className="text-right">Market cap</th>
                    <th className="text-right">Liquidity</th>
                    <th className="text-right">Vol 24h</th>
                    <th>Venue</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.mint} className="cursor-pointer" onClick={() => router.push(`/token/${t.mint}`)}>
                      <td>
                        <TokenLink mint={t.mint} symbol={t.symbol} image={t.imageUrl} />
                        <div className="text-dim text-[11px] truncate max-w-[160px]">{t.name}</div>
                      </td>
                      <td className="text-right">{fmtUsd(t.priceUsd, false)}</td>
                      <td className="text-right">{fmtPct(t.priceChange24hPct)}</td>
                      <td className="text-right">{fmtUsd(t.marketCapUsd)}</td>
                      <td className="text-right">{fmtUsd(t.liquidityUsd)}</td>
                      <td className="text-right">{fmtUsd(t.volume24hUsd)}</td>
                      <td className="text-dim">{t.venue === "pumpfun" ? "curve" : (t.venue ?? "—")}</td>
                      <td className="text-dim">{t.pairCreatedAt ? timeAgo(t.pairCreatedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Launched here">
            {launches.error ? (
              <Notice tone="warn">{launches.error}</Notice>
            ) : launches.loading ? (
              <Loading />
            ) : !launches.data?.launches.length ? (
              <Empty>No launches yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {launches.data.launches.map((l) => (
                  <li key={l.mint} className="flex justify-between">
                    <TokenLink mint={l.mint} symbol={l.symbol} />
                    <span className="text-dim">{timeAgo(l.confirmed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Notice tone="info">
            Escrowless OTC: offers are signed messages, not locked funds. A trade settles only when both wallets sign the same transaction, so an offer is not
            guaranteed to fill.
          </Notice>
        </div>
      </div>

      <Panel title="Active OTC offers" right={<a href="/otc" className="text-info text-xs">Open desk →</a>}>
        {offers.error ? <Notice tone="warn">{offers.error}</Notice> : offers.loading ? <Loading /> : <OrderTable orders={offers.data?.orders.slice(0, 15) ?? []} />}
      </Panel>
    </div>
  );
}
