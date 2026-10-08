"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import { formatRaw, formatSol } from "@/lib/amounts";
import { CLUSTER } from "@/lib/config";
import { useAuth } from "@/client/auth";
import { useHoldings } from "@/client/balances";
import { useApi } from "@/client/hooks";
import type { OrderRow, TradeRow } from "@/client/types";
import { OrderTable } from "../OrderTable";
import { Empty, Loading, Notice, Panel, Status, TxLink, short, timeAgo } from "../ui";

interface ActiveSession {
  id: string;
  order_hash: string;
  state: string;
  buyer: string;
  seller: string;
  created_at: string;
}

export function Portfolio() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { signedIn, signIn } = useAuth();
  const me = publicKey?.toBase58() ?? null;
  const { sol, tokens, error: balError, loading: balLoading } = useHoldings();
  const orders = useApi<{ orders: OrderRow[] }>(me ? `/api/otc/orders?status=all&involving=${me}` : null, { pollMs: 15_000 });
  const sessions = useApi<{ sessions: ActiveSession[] }>(signedIn ? "/api/otc/settlements?state=active" : null, { pollMs: 4_000 });
  const trades = useApi<{ trades: TradeRow[] }>(me ? `/api/otc/trades?wallet=${me}&limit=50` : null);
  const launches = useApi<{ launches: { mint: string; symbol: string; name: string; confirmed_at: string }[] }>(me ? `/api/launches?creator=${me}` : null);
  const [history, setHistory] = useState<ConfirmedSignatureInfo[] | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    connection
      .getSignaturesForAddress(publicKey, { limit: 20 }, "confirmed")
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [publicKey, connection]);

  if (!publicKey) return <Empty>Connect a wallet to see your portfolio.</Empty>;

  const needsMe = (sessions.data?.sessions ?? []).filter((s) => (s.state === "awaiting_buyer" && s.buyer === me) || (s.state === "awaiting_seller" && s.seller === me));
  const open = (orders.data?.orders ?? []).filter((o) => ["open", "settling"].includes(o.status));
  const past = (orders.data?.orders ?? []).filter((o) => !["open", "settling"].includes(o.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Portfolio</h1>
        <p className="text-dim text-xs">
          {short(me, 6)} on {CLUSTER}. Balances are read from the chain. No cost basis or P&amp;L is shown because none is tracked.
        </p>
      </div>

      {!signedIn && (
        <Notice tone="info">
          <button className="underline" onClick={() => signIn().catch(() => undefined)}>
            Sign in
          </button>{" "}
          to see settlements waiting for your signature.
        </Notice>
      )}
      {needsMe.length > 0 && (
        <Notice tone="warn">
          <b>Your signature is needed</b> to settle {needsMe.length} trade{needsMe.length > 1 ? "s" : ""}. These expire in about a minute.
          <div className="mt-2 flex flex-wrap gap-2">
            {needsMe.map((s) => (
              <Link key={s.id} className="btn btn-up text-xs" href={`/trade/${s.id}`}>
                Sign settlement {short(s.id, 4)}
              </Link>
            ))}
          </div>
        </Notice>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <Panel title="Holdings" className="lg:col-span-1">
          {balError && <Notice tone="warn">{balError}</Notice>}
          {balLoading && sol === null ? (
            <Loading />
          ) : (
            <table className="grid-table">
              <tbody>
                <tr>
                  <td className="font-semibold">SOL</td>
                  <td className="text-right">{sol !== null ? formatSol(sol, 6) : "—"}</td>
                </tr>
                {tokens.map((t) => (
                  <tr key={t.account}>
                    <td>
                      <Link href={`/token/${t.mint}`} className="text-info">
                        {short(t.mint)}
                      </Link>
                      {t.tokenProgram.startsWith("Tokenz") && <span className="text-dim text-[10px] ml-1">2022</span>}
                    </td>
                    <td className="text-right">{formatRaw(t.amount, t.decimals, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!balLoading && tokens.length === 0 && <p className="text-dim text-xs mt-2">No token balances.</p>}
        </Panel>

        <div className="lg:col-span-2 space-y-6">
          <Panel title="Open offers and negotiations">
            {orders.loading && !orders.data ? <Loading /> : <OrderTable orders={open} empty="No open offers." />}
          </Panel>
          <Panel title="Completed OTC trades">
            {!trades.data?.trades.length ? (
              <Empty>No completed trades.</Empty>
            ) : (
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Token</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">SOL</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {trades.data.trades.map((t) => (
                    <tr key={t.tx_signature}>
                      <td className={t.buyer === me ? "text-up" : "text-down"}>{t.buyer === me ? "BOUGHT" : "SOLD"}</td>
                      <td>
                        <Link className="text-info" href={`/token/${t.mint}`}>
                          {short(t.mint)}
                        </Link>
                      </td>
                      <td className="text-right">{t.token_amount}</td>
                      <td className="text-right">{formatSol(BigInt(t.buyer === me ? t.gross_lamports : t.seller_net_lamports), 4)}</td>
                      <td className="text-dim">{timeAgo(t.created_at)}</td>
                      <td>
                        <Link className="text-info" href={`/receipt/${t.tx_signature}`}>
                          receipt
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Offer history">
            <OrderTable orders={past} empty="No past offers." />
          </Panel>
          <div className="grid md:grid-cols-2 gap-6">
            <Panel title="Your launches">
              {!launches.data?.launches.length ? (
                <Empty>No launches.</Empty>
              ) : (
                <ul className="space-y-1">
                  {launches.data.launches.map((l) => (
                    <li key={l.mint} className="flex justify-between">
                      <Link className="text-info" href={`/token/${l.mint}`}>
                        {l.symbol}
                      </Link>
                      <span className="text-dim">{timeAgo(l.confirmed_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Recent transactions">
              {history === null ? (
                <Loading />
              ) : history.length === 0 ? (
                <Empty>No transactions found.</Empty>
              ) : (
                <ul className="space-y-1 text-xs">
                  {history.map((h) => (
                    <li key={h.signature} className="flex justify-between gap-2">
                      <TxLink sig={h.signature} />
                      <span className="flex gap-2 items-center">
                        {h.err ? <Status value="failed" /> : null}
                        <span className="text-dim">{h.blockTime ? timeAgo(h.blockTime * 1000) : "—"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
