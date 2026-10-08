"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/config";

export function short(addr: string | null | undefined, n = 4): string {
  if (!addr) return "—";
  return addr.length <= n * 2 + 1 ? addr : `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function Addr({ value, href, n = 4 }: { value: string | null | undefined; href?: string; n?: number }) {
  if (!value) return <span className="text-dim">—</span>;
  return (
    <a href={href ?? explorerAddressUrl(value)} target={href ? undefined : "_blank"} rel="noreferrer" className="text-info hover:underline" title={value}>
      {short(value, n)}
    </a>
  );
}

export function TxLink({ sig }: { sig: string }) {
  return (
    <a href={explorerTxUrl(sig)} target="_blank" rel="noreferrer" className="text-info hover:underline" title={sig}>
      {short(sig, 6)} ↗
    </a>
  );
}

export function Panel({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <h2 className="text-xs uppercase tracking-wider text-dim">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-info/40 text-info bg-info/5",
    warn: "border-warn/40 text-warn bg-warn/5",
    error: "border-down/50 text-down bg-down/5",
    ok: "border-up/40 text-up bg-up/5",
  }[tone];
  return <div className={`border rounded px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</div>;
}

const STATUS_TONE: Record<string, string> = {
  open: "text-up border-up/40",
  settling: "text-warn border-warn/40",
  awaiting_buyer: "text-warn border-warn/40",
  awaiting_seller: "text-warn border-warn/40",
  submitting: "text-info border-info/40",
  submitted: "text-info border-info/40",
  settled: "text-up border-up/40",
  filled: "text-up border-up/40",
  countered: "text-dim border-line",
  cancelled: "text-dim border-line",
  expired: "text-dim border-line",
  failed: "text-down border-down/40",
};

export function Status({ value }: { value: string }) {
  return <span className={`inline-block border rounded px-1.5 py-0.5 text-[11px] uppercase ${STATUS_TONE[value] ?? "text-dim border-line"}`}>{value.replace(/_/g, " ")}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-dim text-center py-8">{children}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="text-dim py-6 text-center animate-pulse">{label}…</div>;
}

export function fmtUsd(v: number | null | undefined, compact = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (compact && Math.abs(v) >= 1000) return "$" + Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(v);
  if (Math.abs(v) < 0.01 && v !== 0) return "$" + v.toPrecision(3);
  return "$" + v.toLocaleString("en", { maximumFractionDigits: 2 });
}

export function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className="text-dim">—</span>;
  return <span className={v >= 0 ? "text-up" : "text-down"}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}

export function TokenLink({ mint, symbol, image }: { mint: string; symbol?: string | null; image?: string | null }) {
  return (
    <Link href={`/token/${mint}`} className="flex items-center gap-2 hover:text-up">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="w-5 h-5 rounded-full bg-panel-2 object-cover" />
      ) : (
        <span className="w-5 h-5 rounded-full bg-panel-2 inline-block" />
      )}
      <span className="font-semibold">{symbol ?? short(mint)}</span>
    </Link>
  );
}

export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.ceil(f / 60)}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
