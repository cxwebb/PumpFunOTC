"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { formatRaw, formatSol } from "@/lib/amounts";
import { MAX_CU_PRICE_MICROLAMPORTS, OTC_FEE_BPS, OTC_TREASURY } from "@/lib/config";
import { fromBase64 } from "@/lib/encoding";
import { orderHash, orderSchema, verifyOrderSignature } from "@/modules/otc/orders/order";
import { deriveSettlementTerms, extractWalletSignature, verifySettlementMessage } from "@/modules/otc/settlement";
import { api } from "@/client/api";
import { useAuth } from "@/client/auth";
import { useApi } from "@/client/hooks";
import type { OrderRow, SessionRow } from "@/client/types";
import { Addr, Loading, Notice, Panel, Status, TxLink, short } from "../ui";

interface Data {
  session: SessionRow;
  order: OrderRow;
  viewer: string | null;
}

/**
 * Rebuild the settlement from the maker-signed order in this browser and
 * compare it with the bytes the server wants signed. The wallet is only
 * prompted when every check passes.
 */
function useVerification(data: Data | null) {
  return useMemo(() => {
    if (!data) return null;
    const errors: string[] = [];
    try {
      const order = orderSchema.parse(data.order.payload);
      if (orderHash(order) !== data.session.order_hash) errors.push("Order hash does not match this settlement");
      if (!verifyOrderSignature(order, data.order.signature)) errors.push("Maker signature on the order is invalid");
      const terms = deriveSettlementTerms(order, data.session.taker);
      if (terms.buyer !== data.session.buyer || terms.seller !== data.session.seller) errors.push("Buyer/seller do not match the order");
      const bytes = fromBase64(data.session.message_b64);
      const r = verifySettlementMessage(
        bytes,
        {
          terms,
          orderHash: data.session.order_hash,
          settlementId: data.session.id,
          recentBlockhash: data.session.recent_blockhash,
          computeUnitLimit: data.session.cu_limit,
          computeUnitPriceMicroLamports: Number(data.session.cu_price_micro_lamports),
        },
        { maxComputeUnitPriceMicroLamports: MAX_CU_PRICE_MICROLAMPORTS, expectedTreasury: OTC_TREASURY, maxFeeBps: OTC_FEE_BPS },
      );
      errors.push(...r.errors);
      return { ok: errors.length === 0, errors, terms, bytes };
    } catch (e) {
      return { ok: false, errors: [...errors, (e as Error).message], terms: null, bytes: null };
    }
  }, [data]);
}

const STEPS = [
  { key: "awaiting_buyer", label: "Buyer signs (pays network fee)" },
  { key: "awaiting_seller", label: "Seller signs" },
  { key: "submitted", label: "Submitted to Solana" },
  { key: "settled", label: "Finalized and reconciled on chain" },
];
const ORDER = ["awaiting_buyer", "awaiting_seller", "submitting", "submitted", "settled"];

export function SettlementView({ id }: { id: string }) {
  const { publicKey, signTransaction } = useWallet();
  const { signedIn, signIn } = useAuth();
  const { data, error, loading, reload } = useApi<Data>(signedIn ? `/api/otc/settlements/${id}` : null, { pollMs: 3_000 });
  const v = useVerification(data);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  if (!signedIn)
    return (
      <Panel title="Settlement">
        <div className="space-y-3">
          <p>Sign in with the wallet that is a party to this settlement.</p>
          <button className="btn btn-up" disabled={!publicKey} onClick={() => signIn().catch(() => undefined)}>
            Sign in
          </button>
        </div>
      </Panel>
    );
  if (loading && !data) return <Loading />;
  if (error || !data) return <Notice tone="error">{error ?? "Settlement not found"}</Notice>;

  const s = data.session;
  const me = publicKey?.toBase58();
  const myRole = me === s.buyer ? "buyer" : me === s.seller ? "seller" : null;
  const myTurn = (s.state === "awaiting_buyer" && myRole === "buyer") || (s.state === "awaiting_seller" && myRole === "seller");
  const terms = v?.terms;
  const idx = ORDER.indexOf(s.state);

  async function sign() {
    setSignError(null);
    if (!v?.ok || !v.bytes || !me) return;
    if (!signTransaction) return setSignError("This wallet cannot sign transactions");
    setBusy(true);
    try {
      const tx = new VersionedTransaction(VersionedMessage.deserialize(v.bytes));
      const signed = await signTransaction(tx);
      const signature = extractWalletSignature(signed, v.bytes, me);
      await api(`/api/otc/settlements/${id}/sign`, { method: "POST", json: { signature } });
      await reload();
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Settlement</h1>
        <Status value={s.state} />
        <Link href={`/offer/${s.order_hash}`} className="text-info text-xs">
          offer {short(s.order_hash, 6)}
        </Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="What this transaction does">
            {terms ? (
              <ul className="space-y-2">
                <li>
                  Seller <Addr value={terms.seller} /> sends <b>{formatRaw(terms.tokenAmount, terms.decimals)}</b> tokens of <Addr value={terms.mint} /> to buyer{" "}
                  <Addr value={terms.buyer} />.
                </li>
                <li>
                  Buyer sends <b>{formatSol(terms.sellerNetLamports)} SOL</b> to the seller.
                </li>
                <li>
                  Buyer sends the <b>{formatSol(terms.feeLamports)} SOL</b> platform fee ({terms.feeBps / 100}%, deducted from the seller&apos;s price) to the treasury{" "}
                  <Addr value={terms.treasury} />.
                </li>
                <li className="text-dim">Buyer pays the network fee and, if needed, rent for their token account. Total price: {formatSol(terms.grossLamports)} SOL.</li>
                <li className="text-dim">All of it happens in one Solana transaction: every transfer lands, or none does.</li>
              </ul>
            ) : (
              <p className="text-dim">Terms could not be derived.</p>
            )}
          </Panel>

          <Panel title="Independent checks (run in your browser)">
            {v?.ok ? (
              <Notice tone="ok">
                ✓ The transaction bytes match a rebuild from the maker-signed order. Only System, Token, Associated Token, Memo and Compute Budget programs are used; amounts,
                recipients, mint, fee and signers are as shown above.
              </Notice>
            ) : (
              <Notice tone="error">
                Verification failed. Do not sign.
                <ul className="list-disc ml-4 mt-1">
                  {v?.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Notice>
            )}
            <p className="text-[11px] text-dim mt-3 break-all">Message SHA-256: {s.message_sha256}</p>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Progress">
            <ol className="space-y-2">
              {STEPS.map((step) => {
                const stepIdx = ORDER.indexOf(step.key);
                const done = idx > stepIdx || s.state === "settled";
                const current = s.state === step.key || (step.key === "submitted" && s.state === "submitting");
                return (
                  <li key={step.key} className={done ? "text-up" : current ? "text-warn" : "text-dim"}>
                    {done ? "✓" : current ? "▸" : "○"} {step.label}
                  </li>
                );
              })}
            </ol>
            {s.tx_signature && ["submitted", "submitting", "settled"].includes(s.state) && (
              <div className="mt-3 text-xs">
                Transaction: <TxLink sig={s.tx_signature} />
              </div>
            )}
          </Panel>

          <Panel title="Your action">
            <div className="space-y-3">
              {!myRole && <Notice tone="warn">The connected wallet is not a party to this settlement.</Notice>}
              {myTurn && (
                <>
                  <button className="btn btn-up w-full" disabled={!v?.ok || busy} onClick={sign}>
                    {busy ? "Waiting for wallet…" : `Sign as ${myRole}`}
                  </button>
                  <p className="text-[11px] text-dim">
                    Your wallet will show the exact transaction. If the wallet changes it before signing, this page refuses the signature.
                  </p>
                </>
              )}
              {myRole && !myTurn && ["awaiting_buyer", "awaiting_seller"].includes(s.state) && (
                <Notice tone="info">Waiting for the {s.state === "awaiting_buyer" ? "buyer" : "seller"} to sign. The transaction expires with its blockhash in about a minute.</Notice>
              )}
              {s.state === "settled" && s.tx_signature && (
                <Link className="btn btn-up w-full" href={`/receipt/${s.tx_signature}`}>
                  View receipt
                </Link>
              )}
              {["expired", "failed", "cancelled"].includes(s.state) && (
                <Notice tone={s.state === "failed" ? "error" : "warn"}>
                  {s.error ?? `Settlement ${s.state}.`} Nothing moved unless a transaction link above shows success. The offer reopens if it is still valid; accept it again to start a
                  new settlement with fresh signatures.
                </Notice>
              )}
              {signError && <Notice tone="error">{signError}</Notice>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
