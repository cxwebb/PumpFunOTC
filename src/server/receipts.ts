import "server-only";
import { VersionedMessage } from "@solana/web3.js";
import { fromBase64 } from "@/lib/encoding";
import { MEMO_PREFIX, MEMO_PROGRAM_ID, reconcileSettlement } from "@/modules/otc/settlement";
import { deserializeTerms, type SessionRow } from "./otc";
import { rpc } from "./solana";
import { db, must } from "./supabase";

export interface Receipt {
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

/** Rebuild a settlement receipt from chain data and check it against the agreed message. */
export async function buildReceipt(signature: string): Promise<Receipt> {
  const conn = rpc();
  const tx =
    (await conn.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 })) ??
    (await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
  if (!tx) return { signature, found: false, finalized: false, recorded: false, verified: false, errors: ["Transaction not found on this network"] };

  const message = tx.transaction.message as VersionedMessage;
  const keys = message.staticAccountKeys;
  let memo: string | null = null;
  for (const ci of message.compiledInstructions) {
    if (keys[ci.programIdIndex]?.equals(MEMO_PROGRAM_ID)) memo = Buffer.from(ci.data).toString("utf8");
  }
  const parts = memo?.startsWith(MEMO_PREFIX + ":") ? memo.split(":") : null;
  const orderHash = parts?.[2] ?? null;
  const settlementId = parts?.[3] ?? null;

  const statuses = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const finalized = statuses.value[0]?.confirmationStatus === "finalized";

  let session: SessionRow | null = null;
  try {
    const rows = must(await db().from("settlement_sessions").select("*").eq("tx_signature", signature).limit(1)) as SessionRow[];
    session = rows[0] ?? null;
  } catch {
    session = null;
  }
  const base: Receipt = { signature, found: true, finalized, slot: tx.slot, blockTime: tx.blockTime, memo, orderHash, settlementId, recorded: false, verified: false, errors: [] };
  if (!session) return { ...base, errors: ["This transaction is not a settlement recorded by this platform"] };
  if (settlementId !== session.id || orderHash !== session.order_hash) base.errors.push("Memo does not match the recorded settlement");

  const terms = deserializeTerms(session.terms);
  const r = reconcileSettlement(tx, fromBase64(session.message_b64), terms);
  const errors = [...base.errors, ...r.errors];
  return {
    ...base,
    recorded: session.state === "settled",
    verified: errors.length === 0,
    errors,
    terms: {
      buyer: terms.buyer,
      seller: terms.seller,
      mint: terms.mint,
      decimals: terms.decimals,
      tokenAmount: terms.tokenAmount.toString(),
      grossLamports: terms.grossLamports.toString(),
      feeLamports: terms.feeLamports.toString(),
      sellerNetLamports: terms.sellerNetLamports.toString(),
      treasury: terms.treasury,
      feeBps: terms.feeBps,
    },
    deltas: {
      tokenDeltaSeller: r.tokenDeltaSeller.toString(),
      tokenDeltaBuyer: r.tokenDeltaBuyer.toString(),
      lamportDeltaSeller: r.lamportDeltaSeller.toString(),
      lamportDeltaTreasury: r.lamportDeltaTreasury.toString(),
      lamportDeltaBuyer: r.lamportDeltaBuyer.toString(),
      networkFeeLamports: r.networkFeeLamports.toString(),
    },
  };
}
