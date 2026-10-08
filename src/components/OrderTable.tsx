"use client";

import Link from "next/link";
import { formatRaw, formatSol, impliedUnitPriceSol } from "@/lib/amounts";
import type { OrderRow } from "@/client/types";
import { Addr, Empty, Status, short, timeAgo } from "./ui";

export function OrderTable({ orders, showToken = true, empty = "No offers yet." }: { orders: OrderRow[]; showToken?: boolean; empty?: string }) {
  if (!orders.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Side</th>
            {showToken && <th>Token</th>}
            <th className="text-right">Amount</th>
            <th className="text-right">Total SOL</th>
            <th className="text-right">SOL / token</th>
            <th>Maker</th>
            <th>To</th>
            <th>Expires</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.hash}>
              <td className={o.side === "sell" ? "text-down" : "text-up"}>{o.side === "sell" ? "ASK" : "BID"}</td>
              {showToken && (
                <td>
                  <Link href={`/token/${o.mint}`} className="hover:text-up">
                    {short(o.mint)}
                  </Link>
                </td>
              )}
              <td className="text-right">{formatRaw(BigInt(o.token_amount), o.decimals, 4)}</td>
              <td className="text-right">{formatSol(BigInt(o.lamports), 4)}</td>
              <td className="text-right text-dim">{impliedUnitPriceSol(BigInt(o.lamports), BigInt(o.token_amount), o.decimals)}</td>
              <td>
                <Addr value={o.maker} />
              </td>
              <td>{o.counterparty ? <Addr value={o.counterparty} /> : <span className="text-dim">public</span>}</td>
              <td className="text-dim">{timeAgo(o.expires_at)}</td>
              <td>
                <Status value={o.status} />
              </td>
              <td>
                <Link href={`/offer/${o.hash}`} className="text-info hover:underline">
                  view
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
