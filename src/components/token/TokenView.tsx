"use client";

import Link from "next/link";
import { formatRaw } from "@/lib/amounts";
import { CLUSTER } from "@/lib/config";
import { useApi } from "@/client/hooks";
import type { OrderRow, TradeRow } from "@/client/types";
import type { MarketToken } from "@/modules/market-data/types";
import { OrderTable } from "../OrderTable";
import { Addr, Empty, Loading, Notice, Panel, fmtPct, fmtUsd, short } from "../ui";
import { PriceChart } from "./PriceChart";
import { TradePanel } from "./TradePanel";

interface TokenData {
  chain: {
    found: boolean;
    error?: string;
    safety: { ok: boolean; reasons: string[]; tokenProgram: string; decimals: number; supply: string; extensions: string[]; mintAuthority: string | null; freezeAuthority: string | null } | null;
    metadata: { name: string; symbol: string; uri: string } | null;
    venue: { venue: string; progress: number | null; pool: string | null; creator: string | null } | null;
  };
  market: MarketToken | null | { error: string };
}

export function TokenView({ mint }: { mint: string }) {
  const { data, error, loading } = useApi<TokenData>(`/api/tokens/${mint}`, { pollMs: 30_000 });
  const offers = useApi<{ orders: OrderRow[] }>(`/api/otc/orders?mint=${mint}&status=open`, { pollMs: 15_000 });
  const trades = useApi<{ trades: TradeRow[] }>(`/api/otc/trades?mint=${mint}&limit=10`);

  if (loading && !data) return <Loading />;
  if (error || !data) return <Notice tone="error">{error ?? "Token unavailable"}</Notice>;

  const market = data.market && !("error" in data.market) ? data.market : null;
  const marketError = data.market && "error" in data.market ? data.market.error : null;
  const chain = data.chain;
  const name = chain.metadata?.name ?? market?.name ?? "Unknown token";
  const symbol = chain.metadata?.symbol ?? market?.symbol ?? short(mint);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        {market?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={market.imageUrl} alt="" className="w-10 h-10 rounded-full bg-panel-2" />
        )}
        <div>
          <h1 className="text-xl font-bold">
            {symbol} <span className="text-dim font-normal text-sm">{name}</span>
          </h1>
          <div className="text-[11px] text-dim break-all">
            Mint <Addr value={mint} n={8} />
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href={`/otc?mint=${mint}`} className="btn btn-up">
            Create OTC offer
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Metric k="Price" v={fmtUsd(market?.priceUsd, false)} />
        <Metric k="24h" v={fmtPct(market?.priceChange24hPct)} />
        <Metric k="Market cap" v={fmtUsd(market?.marketCapUsd)} />
        <Metric k="Liquidity" v={fmtUsd(market?.liquidityUsd)} />
        <Metric k="Volume 24h" v={fmtUsd(market?.volume24hUsd)} />
        <Metric k="Txns 24h" v={market?.buys24h != null ? `${market.buys24h} / ${market.sells24h}` : "—"} sub="buys / sells" />
      </div>
      {marketError && <Notice tone="warn">Market data unavailable: {marketError}</Notice>}
      {!market && !marketError && <Notice tone="info">No mainnet market pair found for this mint. Metrics are shown as unavailable rather than estimated.</Notice>}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Chart">
            <PriceChart pool={market?.pairAddress ?? null} />
          </Panel>
          <Panel title="OTC offers for this token" right={<Link className="text-info text-xs" href={`/otc?mint=${mint}`}>Create offer →</Link>}>
            {offers.error ? <Notice tone="warn">{offers.error}</Notice> : <OrderTable orders={offers.data?.orders ?? []} showToken={false} empty="No open OTC offers for this token." />}
          </Panel>
          <Panel title="Settled OTC trades">
            {!trades.data?.trades.length ? (
              <Empty>No settled OTC trades for this token yet.</Empty>
            ) : (
              <ul className="space-y-1 text-xs">
                {trades.data.trades.map((t) => (
                  <li key={t.tx_signature}>
                    <Link href={`/receipt/${t.tx_signature}`} className="text-info">
                      {short(t.tx_signature, 6)}
                    </Link>{" "}
                    · {formatRaw(BigInt(t.token_amount), chain.safety?.decimals ?? 0, 2)} tokens
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={`Trade on ${CLUSTER}`}>
            <TradePanel mint={mint} decimals={chain.safety?.decimals ?? null} venue={chain.venue?.venue ?? null} />
          </Panel>
          <Panel title={`On-chain (${CLUSTER})`}>
            {!chain.found ? (
              <Notice tone="warn">Not found on {CLUSTER}: {chain.error}</Notice>
            ) : (
              <dl className="space-y-1.5 text-xs">
                <Info k="Venue" v={chain.venue?.venue === "curve" ? "Pump.fun bonding curve" : chain.venue?.venue === "pumpswap" ? "PumpSwap (graduated)" : "None found"} />
                {chain.venue?.progress != null && (
                  <div>
                    <div className="flex justify-between">
                      <span className="text-dim">Graduation progress</span>
                      <span>{(chain.venue.progress * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-bg rounded mt-1">
                      <div className="h-1.5 bg-up rounded" style={{ width: `${chain.venue.progress * 100}%` }} />
                    </div>
                  </div>
                )}
                <Info k="Token program" v={chain.safety?.tokenProgram.startsWith("Tokenz") ? "Token-2022" : "SPL Token"} />
                <Info k="Decimals" v={chain.safety?.decimals} />
                <Info k="Supply" v={chain.safety ? formatRaw(BigInt(chain.safety.supply), chain.safety.decimals, 0) : "—"} />
                <Info k="Mint authority" v={chain.safety?.mintAuthority ? short(chain.safety.mintAuthority) : "none"} />
                <Info k="Freeze authority" v={chain.safety?.freezeAuthority ? short(chain.safety.freezeAuthority) : "none"} />
                <Info k="Extensions" v={chain.safety?.extensions.length ? chain.safety.extensions.join(", ") : "none"} />
                <Info k="OTC eligible" v={chain.safety?.ok ? <span className="text-up">yes</span> : <span className="text-down">no</span>} />
                {chain.safety && !chain.safety.ok && <p className="text-down">{chain.safety.reasons.join("; ")}</p>}
              </dl>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Metric({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="panel px-3 py-2">
      <div className="label !mb-0.5">{k}</div>
      <div className="text-sm font-semibold">{v}</div>
      {sub && <div className="text-[10px] text-dim">{sub}</div>}
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-dim">{k}</dt>
      <dd className="text-right">{v ?? "—"}</dd>
    </div>
  );
}
