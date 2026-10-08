"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { computeFee, formatRaw, formatSol, impliedUnitPriceSol } from "@/lib/amounts";
import { APP_DOMAIN, CLUSTER } from "@/lib/config";
import { base58 } from "@/lib/encoding";
import { cancelMessage, orderHash, orderSchema, orderSigningMessage, verifyOrderSignature } from "@/modules/otc/orders/order";
import { api } from "@/client/api";
import { useAuth } from "@/client/auth";
import { useApi, useNow } from "@/client/hooks";
import type { OrderRow } from "@/client/types";
import { Addr, Loading, Notice, Panel, Status, TxLink, short, timeAgo } from "../ui";
import { CreateOfferForm } from "./CreateOfferForm";

interface Detail {
  order: OrderRow;
  chain: OrderRow[];
  sessions: { id: string; state: string; buyer: string; seller: string; tx_signature: string | null; error: string | null; created_at: string }[];
  viewer: string | null;
}

export function OfferDetail({ hash }: { hash: string }) {
  const router = useRouter();
  const { publicKey, signMessage } = useWallet();
  const { signedIn, signIn } = useAuth();
  const { data, error, loading, reload } = useApi<Detail>(`/api/otc/orders/${hash}`, { pollMs: 8_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCounter, setShowCounter] = useState(false);
  const now = useNow();

  const verification = useMemo(() => {
    if (!data) return null;
    try {
      const payload = orderSchema.parse(data.order.payload);
      const hashOk = orderHash(payload) === data.order.hash;
      const sigOk = verifyOrderSignature(payload, data.order.signature);
      return { payload, hashOk, sigOk, message: orderSigningMessage(payload) };
    } catch (e) {
      return { payload: null, hashOk: false, sigOk: false, message: (e as Error).message };
    }
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <Notice tone="error">{error ?? "Not found"}</Notice>;

  const o = data.order;
  const me = publicKey?.toBase58() ?? null;
  const isMaker = me === o.maker;
  const canTake = !!me && !isMaker && o.status === "open" && (o.counterparty === null || o.counterparty === me) && Date.parse(o.expires_at) > now;
  const lamports = BigInt(o.lamports);
  const fee = computeFee(lamports, o.fee_bps);
  const active = data.sessions.find((s) => ["awaiting_buyer", "awaiting_seller", "submitting", "submitted"].includes(s.state));
  const newest = data.chain[data.chain.length - 1];

  async function run(label: string, fn: () => Promise<void>) {
    setActionError(null);
    setBusy(label);
    try {
      if (!signedIn) await signIn();
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const accept = () =>
    run("accept", async () => {
      const r = await api<{ session: { id: string } }>(`/api/otc/orders/${o.hash}/accept`, { method: "POST" });
      router.push(`/trade/${r.session.id}`);
    });

  const cancel = () =>
    run("cancel", async () => {
      if (!signMessage || !me) throw new Error("Wallet cannot sign messages");
      const issuedAt = new Date().toISOString();
      const msg = cancelMessage({ domain: APP_DOMAIN, network: CLUSTER, orderHash: o.hash, maker: me, issuedAt });
      const sig = await signMessage(new TextEncoder().encode(msg));
      await api(`/api/otc/orders/${o.hash}/cancel`, { method: "POST", json: { issuedAt, signature: base58.encode(sig) } });
      await reload();
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">
          <span className={o.side === "sell" ? "text-down" : "text-up"}>{o.side === "sell" ? "ASK" : "BID"}</span> · {formatRaw(BigInt(o.token_amount), o.decimals)} tokens for {formatSol(lamports)} SOL
        </h1>
        <Status value={o.status} />
        {o.counterparty && <span className="text-warn text-xs border border-warn/40 rounded px-1.5 py-0.5">PRIVATE</span>}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Terms">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
              <Term k="Token" v={<Link className="text-info" href={`/token/${o.mint}`}>{short(o.mint, 6)}</Link>} />
              <Term k="Maker" v={<Addr value={o.maker} />} />
              <Term k="Amount" v={`${formatRaw(BigInt(o.token_amount), o.decimals)} (raw ${o.token_amount})`} />
              <Term k="Counterparty" v={o.counterparty ? <Addr value={o.counterparty} /> : "Anyone"} />
              <Term k="Total price" v={`${formatSol(lamports)} SOL`} />
              <Term k="Implied price" v={`${impliedUnitPriceSol(lamports, BigInt(o.token_amount), o.decimals)} SOL/token`} />
              <Term k={`Platform fee (${o.fee_bps / 100}%)`} v={`${formatSol(fee)} SOL, from seller proceeds`} />
              <Term k="Seller receives" v={`${formatSol(lamports - fee)} SOL`} />
              <Term k="Partial fills" v="No (all or nothing)" />
              <Term k="Expires" v={`${new Date(o.expires_at).toLocaleString()} (${timeAgo(o.expires_at)})`} />
            </dl>
          </Panel>

          <Panel title="Negotiation">
            <ol className="space-y-2">
              {data.chain.map((c, i) => (
                <li key={c.hash} className={`flex flex-wrap items-center gap-3 p-2 rounded ${c.hash === o.hash ? "bg-panel-2" : ""}`}>
                  <span className="text-dim w-5">#{i + 1}</span>
                  <span className={c.side === "sell" ? "text-down" : "text-up"}>{c.side === "sell" ? "ASK" : "BID"}</span>
                  <span>
                    {formatRaw(BigInt(c.token_amount), c.decimals, 4)} for {formatSol(BigInt(c.lamports), 4)} SOL
                  </span>
                  <span className="text-dim">by {short(c.maker)}</span>
                  <Status value={c.status} />
                  <Link className="text-info ml-auto" href={`/offer/${c.hash}`}>
                    {c.hash === o.hash ? "viewing" : "view"}
                  </Link>
                </li>
              ))}
            </ol>
            {newest && newest.hash !== o.hash && (
              <p className="text-dim text-xs mt-3">
                Only the newest revision can be accepted or countered: <Link href={`/offer/${newest.hash}`} className="text-info">open it</Link>.
              </p>
            )}
          </Panel>

          <Panel title="Signature verification (in your browser)">
            {verification && (
              <div className="space-y-3">
                <div className="flex gap-4 text-xs">
                  <span className={verification.hashOk ? "text-up" : "text-down"}>{verification.hashOk ? "✓" : "✗"} order hash matches canonical JSON</span>
                  <span className={verification.sigOk ? "text-up" : "text-down"}>{verification.sigOk ? "✓" : "✗"} maker signature valid</span>
                </div>
                <details>
                  <summary className="cursor-pointer text-dim text-xs">Signed message</summary>
                  <pre className="mt-2 text-[11px] whitespace-pre-wrap bg-bg border border-line rounded p-3">{verification.message}</pre>
                </details>
                <p className="text-[11px] text-dim break-all">Hash: {o.hash}</p>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Actions">
            <div className="space-y-3">
              {active && (me === active.buyer || me === active.seller) && (
                <Link href={`/trade/${active.id}`} className="btn btn-up w-full">
                  Continue settlement →
                </Link>
              )}
              {active && !(me === active.buyer || me === active.seller) && <Notice tone="warn">A settlement is in progress for this offer.</Notice>}
              {canTake && (
                <>
                  <button className="btn btn-up w-full" onClick={accept} disabled={!!busy}>
                    {busy === "accept" ? "Preparing settlement…" : o.side === "sell" ? "Buy now (accept & settle)" : "Sell now (accept & settle)"}
                  </button>
                  <button className="btn w-full" onClick={() => setShowCounter((v) => !v)}>
                    {showCounter ? "Hide counteroffer" : "Make a counteroffer"}
                  </button>
                  <p className="text-[11px] text-dim">
                    Accepting builds one settlement transaction. You and the maker must both sign it within about a minute, before its blockhash expires. If the maker is not online, it
                    will expire and nothing moves.
                  </p>
                </>
              )}
              {isMaker && ["open", "settling"].includes(o.status) && (
                <button className="btn btn-down w-full" onClick={cancel} disabled={!!busy}>
                  {busy === "cancel" ? "Signing…" : "Cancel offer"}
                </button>
              )}
              {isMaker && o.status === "open" && (
                <Notice tone="info">Keep this page open: when a taker accepts, you will be asked to sign the settlement here or on your Portfolio page.</Notice>
              )}
              {!me && <Notice tone="info">Connect a wallet to accept, counter or cancel.</Notice>}
              {actionError && <Notice tone="error">{actionError}</Notice>}
              {isMaker && <p className="text-[11px] text-dim">Cancelling stops this app collecting signatures. A settlement you already signed stays valid until its blockhash expires (about 60–90 seconds).</p>}
            </div>
          </Panel>
          {showCounter && canTake && (
            <Panel title="Counteroffer">
              <CreateOfferForm parent={o} />
            </Panel>
          )}
          {data.sessions.length > 0 && (
            <Panel title="Settlement attempts">
              <ul className="space-y-2 text-xs">
                {data.sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <Status value={s.state} />
                    <span className="text-dim">{timeAgo(s.created_at)}</span>
                    {s.tx_signature && s.state === "settled" && (
                      <Link className="text-info" href={`/receipt/${s.tx_signature}`}>
                        receipt
                      </Link>
                    )}
                    {s.tx_signature && <TxLink sig={s.tx_signature} />}
                    {s.error && <span className="text-dim w-full">{s.error}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Term({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/50 py-1">
      <dt className="text-dim">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
