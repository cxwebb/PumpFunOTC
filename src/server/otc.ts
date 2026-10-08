import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { PublicKey, VersionedMessage } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { parseRaw } from "@/lib/amounts";
import {
  APP_DOMAIN,
  CLUSTER,
  MAX_CU_PRICE_MICROLAMPORTS,
  MAX_ORDER_LIFETIME_SECONDS,
  OTC_FEE_BPS,
  SETTLEMENT_CU_LIMIT,
} from "@/lib/config";
import { base58, fromBase64, toBase64 } from "@/lib/encoding";
import {
  type Order,
  cancelMessage,
  checkCounter,
  orderHash,
  orderSchema,
  verifyDetachedSignature,
  verifyOrderSignature,
} from "@/modules/otc/orders/order";
import {
  type SettlementBuildParams,
  type SettlementTerms,
  assembleSignedTransaction,
  buildSettlementMessageBytes,
  deriveSettlementTerms,
  reconcileSettlement,
  verifyMessageSignature,
  verifySettlementMessage,
} from "@/modules/otc/settlement";
import { checkMintSafety } from "@/modules/tokens/safety";
import { treasuryAddress } from "./env";
import { HttpError } from "./http";
import { rpc } from "./solana";
import { audit, db, must } from "./supabase";

const CU_PRICE = Math.min(Number(process.env.SETTLEMENT_CU_PRICE_MICROLAMPORTS ?? "10000"), MAX_CU_PRICE_MICROLAMPORTS);
/** Buyer must hold the price plus this margin for rent and network fees. */
const BUYER_SOL_MARGIN = 5_000_000n;

export interface OrderRow {
  hash: string;
  payload: Order;
  signature: string;
  network: string;
  side: "sell" | "buy";
  maker: string;
  counterparty: string | null;
  mint: string;
  token_program: string;
  decimals: number;
  token_amount: string;
  lamports: string;
  fee_bps: number;
  parent_hash: string | null;
  root_hash: string;
  nonce: string;
  expires_at: string;
  status: "open" | "settling" | "countered" | "cancelled" | "filled" | "expired";
  created_at: string;
  updated_at: string;
}

export type SessionState =
  | "awaiting_buyer"
  | "awaiting_seller"
  | "submitting"
  | "submitted"
  | "settled"
  | "expired"
  | "failed"
  | "cancelled";

export interface SessionRow {
  id: string;
  order_hash: string;
  network: string;
  buyer: string;
  seller: string;
  taker: string;
  terms: SerializedTerms;
  message_b64: string;
  message_sha256: string;
  recent_blockhash: string;
  last_valid_block_height: number;
  cu_limit: number;
  cu_price_micro_lamports: number;
  buyer_signature: string | null;
  seller_signature: string | null;
  tx_signature: string | null;
  state: SessionState;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type SerializedTerms = { [K in keyof SettlementTerms]: SettlementTerms[K] extends bigint ? string : SettlementTerms[K] };

export function serializeTerms(t: SettlementTerms): SerializedTerms {
  return {
    ...t,
    tokenAmount: t.tokenAmount.toString(),
    grossLamports: t.grossLamports.toString(),
    feeLamports: t.feeLamports.toString(),
    sellerNetLamports: t.sellerNetLamports.toString(),
  };
}

export function deserializeTerms(t: SerializedTerms): SettlementTerms {
  return {
    ...t,
    tokenAmount: BigInt(t.tokenAmount),
    grossLamports: BigInt(t.grossLamports),
    feeLamports: BigInt(t.feeLamports),
    sellerNetLamports: BigInt(t.sellerNetLamports),
  };
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const nowSec = () => Math.floor(Date.now() / 1000);

function sessionBuildParams(s: SessionRow): SettlementBuildParams {
  return {
    terms: deserializeTerms(s.terms),
    orderHash: s.order_hash,
    settlementId: s.id,
    recentBlockhash: s.recent_blockhash,
    computeUnitLimit: s.cu_limit,
    computeUnitPriceMicroLamports: Number(s.cu_price_micro_lamports),
  };
}

function verifyOptions() {
  return { maxComputeUnitPriceMicroLamports: MAX_CU_PRICE_MICROLAMPORTS, expectedTreasury: treasuryAddress(), maxFeeBps: OTC_FEE_BPS };
}

// ------------------------------------------------------------------ reads

export async function getOrderRow(hash: string): Promise<OrderRow | null> {
  const rows = must(await db().from("otc_orders").select("*").eq("hash", hash).limit(1)) as OrderRow[];
  return rows[0] ?? null;
}

export function canView(row: OrderRow, viewer: string | null): boolean {
  return row.counterparty === null || viewer === row.maker || viewer === row.counterparty;
}

/** Mark open orders past expiry as expired. Cheap, idempotent. */
export async function expireStaleOrders() {
  await db().from("otc_orders").update({ status: "expired" }).eq("status", "open").lt("expires_at", new Date().toISOString());
}

export async function listOrders(f: { mint?: string; side?: string; status?: string; maker?: string; involving?: string; viewer: string | null; limit?: number }) {
  await expireStaleOrders();
  let q = db().from("otc_orders").select("*").order("created_at", { ascending: false }).limit(Math.min(f.limit ?? 100, 200));
  if (f.mint) q = q.eq("mint", f.mint);
  if (f.side) q = q.eq("side", f.side);
  if (f.status && f.status !== "all") q = q.eq("status", f.status);
  if (f.maker) q = q.eq("maker", f.maker);
  if (f.involving) q = q.or(`maker.eq.${f.involving},counterparty.eq.${f.involving}`);
  const rows = must(await q) as OrderRow[];
  return rows.filter((r) => canView(r, f.viewer));
}

export async function orderChain(root: string, viewer: string | null): Promise<OrderRow[]> {
  const rows = must(await db().from("otc_orders").select("*").eq("root_hash", root).order("created_at", { ascending: true })) as OrderRow[];
  return rows.filter((r) => canView(r, viewer));
}

// ------------------------------------------------------------------ create / counter / cancel

async function assertBalancesForOrder(order: Order) {
  const conn = rpc();
  const maker = new PublicKey(order.maker);
  if (order.side === "sell") {
    const ata = getAssociatedTokenAddressSync(new PublicKey(order.mint), maker, false, new PublicKey(order.tokenProgram));
    const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
    if (!bal || BigInt(bal.value.amount) < parseRaw(order.tokenAmount)) throw new HttpError(400, "Your wallet does not hold enough of this token for this offer");
  } else {
    const lamports = BigInt(await conn.getBalance(maker, "confirmed"));
    if (lamports < parseRaw(order.lamports)) throw new HttpError(400, "Your wallet does not hold enough SOL for this bid");
  }
}

export async function createOrder(input: { order: unknown; signature: string }, wallet: string): Promise<OrderRow> {
  const order = orderSchema.parse(input.order);
  if (order.maker !== wallet) throw new HttpError(403, "Order maker must be your signed-in wallet");
  if (order.domain !== APP_DOMAIN) throw new HttpError(400, "Order was signed for a different domain");
  if (order.network !== CLUSTER) throw new HttpError(400, `Order network must be ${CLUSTER}`);
  if (order.feeBps !== OTC_FEE_BPS) throw new HttpError(400, `Platform fee must be ${OTC_FEE_BPS} bps`);
  if (order.treasury !== treasuryAddress()) throw new HttpError(400, "Fee destination must be the published treasury");
  if (order.expiresAt < nowSec() + 60) throw new HttpError(400, "Expiry must be at least one minute away");
  if (order.expiresAt > nowSec() + MAX_ORDER_LIFETIME_SECONDS) throw new HttpError(400, "Expiry is too far in the future");
  if (order.counterparty === order.maker) throw new HttpError(400, "Counterparty cannot be yourself");
  if (!verifyOrderSignature(order, input.signature)) throw new HttpError(400, "Maker signature is invalid");

  const safety = await checkMintSafety(rpc(), order.mint).catch((e: Error) => {
    throw new HttpError(400, e.message);
  });
  if (safety.tokenProgram !== order.tokenProgram) throw new HttpError(400, "Token program does not match the mint");
  if (safety.decimals !== order.decimals) throw new HttpError(400, "Token decimals do not match the mint");
  if (!safety.ok) throw new HttpError(400, `Token is not supported for OTC: ${safety.reasons.join("; ")}`);
  await assertBalancesForOrder(order);

  const hash = orderHash(order);
  let rootHash = hash;
  if (order.parentHash) {
    const parent = await getOrderRow(order.parentHash);
    if (!parent) throw new HttpError(404, "Parent order not found");
    if (parent.status !== "open") throw new HttpError(409, "Only the newest open revision can be countered");
    const check = checkCounter(parent.payload, parent.hash, order);
    if (!check.ok) throw new HttpError(400, check.reason!);
    rootHash = parent.root_hash;
  }
  const row = {
    hash,
    payload: order,
    signature: input.signature,
    network: order.network,
    side: order.side,
    maker: order.maker,
    counterparty: order.counterparty,
    mint: order.mint,
    token_program: order.tokenProgram,
    decimals: order.decimals,
    token_amount: order.tokenAmount,
    lamports: order.lamports,
    fee_bps: order.feeBps,
    parent_hash: order.parentHash,
    root_hash: rootHash,
    nonce: order.nonce,
    expires_at: new Date(order.expiresAt * 1000).toISOString(),
  };
  must(await db().rpc(order.parentHash ? "otc_post_counter" : "otc_insert_order", { p_order: row }));
  await audit(order.parentHash ? "otc.counter" : "otc.order", wallet, hash, { parent: order.parentHash });
  return (await getOrderRow(hash))!;
}

export async function cancelOrder(hash: string, wallet: string, input: { issuedAt: string; signature: string }) {
  const row = await getOrderRow(hash);
  if (!row) throw new HttpError(404, "Order not found");
  if (row.maker !== wallet) throw new HttpError(403, "Only the maker can cancel this order");
  if (!["open", "settling"].includes(row.status)) throw new HttpError(409, `Order is ${row.status}`);
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw new HttpError(400, "Cancel message is stale");
  const message = cancelMessage({ domain: APP_DOMAIN, network: CLUSTER, orderHash: hash, maker: wallet, issuedAt: input.issuedAt });
  if (!verifyDetachedSignature(message, input.signature, wallet)) throw new HttpError(400, "Cancel signature is invalid");

  // Stop any live signing session first so no further signatures are collected.
  const live = must(
    await db().from("settlement_sessions").select("id,state").eq("order_hash", hash).in("state", ["awaiting_buyer", "awaiting_seller"]),
  ) as { id: string }[];
  for (const s of live) must(await db().rpc("otc_end_session", { p_session_id: s.id, p_state: "cancelled", p_error: "Order cancelled by maker" }));

  const updated = must(
    await db().from("otc_orders").update({ status: "cancelled" }).eq("hash", hash).in("status", ["open"]).select("hash"),
  ) as unknown[];
  if (updated.length !== 1) throw new HttpError(409, "Order could not be cancelled (a settlement may already be submitting)");
  must(await db().from("otc_cancellations").insert({ order_hash: hash, maker: wallet, message, signature: input.signature }));
  await audit("otc.cancel", wallet, hash);
}

// ------------------------------------------------------------------ settlement

export async function acceptOrder(hash: string, taker: string): Promise<SessionRow> {
  const row = await getOrderRow(hash);
  if (!row || !canView(row, taker)) throw new HttpError(404, "Order not found");
  if (row.status !== "open") throw new HttpError(409, `Order is ${row.status}`);
  if (Date.parse(row.expires_at) <= Date.now()) throw new HttpError(409, "Order has expired");
  const order = orderSchema.parse(row.payload);
  if (orderHash(order) !== row.hash || !verifyOrderSignature(order, row.signature)) throw new HttpError(500, "Stored order failed verification");
  if (order.treasury !== treasuryAddress() || order.feeBps > OTC_FEE_BPS) throw new HttpError(409, "Order fee terms no longer match the platform");

  let terms: SettlementTerms;
  try {
    terms = deriveSettlementTerms(order, taker);
  } catch (e) {
    throw new HttpError(403, (e as Error).message);
  }

  const conn = rpc();
  const safety = await checkMintSafety(conn, order.mint);
  if (!safety.ok || safety.tokenProgram !== order.tokenProgram || safety.decimals !== order.decimals)
    throw new HttpError(409, `Token is not supported for settlement: ${safety.reasons.join("; ") || "mint changed"}`);

  const sellerAta = getAssociatedTokenAddressSync(new PublicKey(terms.mint), new PublicKey(terms.seller), false, new PublicKey(terms.tokenProgram));
  const [sellerTok, buyerLamports, latest] = await Promise.all([
    conn.getTokenAccountBalance(sellerAta, "confirmed").catch(() => null),
    conn.getBalance(new PublicKey(terms.buyer), "confirmed"),
    conn.getLatestBlockhash("confirmed"),
  ]);
  if (!sellerTok || BigInt(sellerTok.value.amount) < terms.tokenAmount) throw new HttpError(409, "Seller no longer holds enough tokens");
  if (BigInt(buyerLamports) < terms.grossLamports + BUYER_SOL_MARGIN) throw new HttpError(409, "Buyer does not hold enough SOL (price plus about 0.005 SOL for fees and rent)");

  const id = randomUUID();
  const params: SettlementBuildParams = {
    terms,
    orderHash: hash,
    settlementId: id,
    recentBlockhash: latest.blockhash,
    computeUnitLimit: SETTLEMENT_CU_LIMIT,
    computeUnitPriceMicroLamports: CU_PRICE,
  };
  const bytes = buildSettlementMessageBytes(params);
  const check = verifySettlementMessage(bytes, params, verifyOptions());
  if (!check.ok) throw new HttpError(500, `Settlement self-check failed: ${check.errors.join("; ")}`);

  must(
    await db().rpc("otc_claim_order", {
      p_order_hash: hash,
      p_session: {
        id,
        network: CLUSTER,
        buyer: terms.buyer,
        seller: terms.seller,
        taker,
        terms: serializeTerms(terms),
        message_b64: toBase64(bytes),
        message_sha256: sha256Hex(bytes),
        recent_blockhash: latest.blockhash,
        last_valid_block_height: latest.lastValidBlockHeight,
        cu_limit: SETTLEMENT_CU_LIMIT,
        cu_price_micro_lamports: CU_PRICE,
      },
    }),
  );
  await audit("otc.accept", taker, hash, { session: id });
  return (await getSession(id))!;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const rows = must(await db().from("settlement_sessions").select("*").eq("id", id).limit(1)) as SessionRow[];
  return rows[0] ?? null;
}

async function endSession(id: string, state: "expired" | "failed" | "cancelled", error: string) {
  must(await db().rpc("otc_end_session", { p_session_id: id, p_state: state, p_error: error }));
}

/** Record a buyer or seller signature over the stored message bytes. */
export async function submitSignature(id: string, wallet: string, signature: string): Promise<SessionRow> {
  let s = await getSession(id);
  if (!s) throw new HttpError(404, "Settlement not found");
  s = await advanceSession(s);
  const bytes = fromBase64(s.message_b64);
  const isBuyerTurn = s.state === "awaiting_buyer" && wallet === s.buyer;
  const isSellerTurn = s.state === "awaiting_seller" && wallet === s.seller;
  if (!isBuyerTurn && !isSellerTurn) {
    if (wallet !== s.buyer && wallet !== s.seller) throw new HttpError(403, "You are not a party to this settlement");
    throw new HttpError(409, `Not your turn to sign (state: ${s.state})`);
  }
  // Re-verify the stored message before accepting any signature.
  const check = verifySettlementMessage(bytes, sessionBuildParams(s), verifyOptions());
  if (!check.ok) {
    await endSession(s.id, "failed", "Stored message failed verification");
    throw new HttpError(500, "Stored settlement failed verification and was retired");
  }
  if (!verifyMessageSignature(bytes, wallet, signature)) throw new HttpError(400, "Signature is not valid for this exact transaction");

  if (isBuyerTurn) {
    const upd = must(
      await db().from("settlement_sessions").update({ buyer_signature: signature, state: "awaiting_seller" }).eq("id", id).eq("state", "awaiting_buyer").select("id"),
    ) as unknown[];
    if (upd.length !== 1) throw new HttpError(409, "Settlement changed state; reload and try again");
    await audit("otc.sign.buyer", wallet, id);
    return (await getSession(id))!;
  }

  // Seller signs last. The transaction signature is the buyer's (fee payer) signature.
  const upd = must(
    await db()
      .from("settlement_sessions")
      .update({ seller_signature: signature, state: "submitting", tx_signature: s.buyer_signature })
      .eq("id", id)
      .eq("state", "awaiting_seller")
      .select("id"),
  ) as unknown[];
  if (upd.length !== 1) throw new HttpError(409, "Settlement changed state; reload and try again");
  await audit("otc.sign.seller", wallet, id);
  const fresh = (await getSession(id))!;
  await broadcast(fresh);
  return advanceSession((await getSession(id))!);
}

async function broadcast(s: SessionRow) {
  const conn = rpc();
  const bytes = fromBase64(s.message_b64);
  const tx = assembleSignedTransaction(bytes, [
    { signer: s.buyer, signature: s.buyer_signature! },
    { signer: s.seller, signature: s.seller_signature! },
  ]);
  if (base58.encode(tx.signatures[0]) !== s.tx_signature) throw new Error("Transaction signature mismatch");
  const sim = await conn.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
  if (sim.value.err) {
    await endSession(s.id, "failed", `Simulation failed: ${JSON.stringify(sim.value.err)}`);
    await audit("otc.simulation_failed", null, s.id, { err: sim.value.err, logs: sim.value.logs?.slice(-10) });
    return;
  }
  try {
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
    must(await db().from("settlement_sessions").update({ state: "submitted" }).eq("id", s.id).eq("state", "submitting"));
  } catch (e) {
    // The transaction may still have reached a leader; advanceSession resolves it by signature status.
    await audit("otc.send_error", null, s.id, { message: (e as Error).message });
  }
}

/**
 * Move a session forward using chain state only. Idempotent and safe to call
 * from any request (polling, refresh, sign).
 */
export async function advanceSession(s: SessionRow): Promise<SessionRow> {
  if (["settled", "expired", "failed", "cancelled"].includes(s.state)) return s;
  const conn = rpc();
  const height = await conn.getBlockHeight("confirmed");
  const blockhashDead = height > s.last_valid_block_height;

  if (s.state === "awaiting_buyer" || s.state === "awaiting_seller") {
    if (blockhashDead) await endSession(s.id, "expired", "Blockhash expired before both parties signed");
    return (await getSession(s.id))!;
  }

  // submitting / submitted: the chain decides.
  const sig = s.tx_signature!;
  const status = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
  if (status?.err) {
    await endSession(s.id, "failed", `Transaction failed on chain: ${JSON.stringify(status.err)}`);
  } else if (status?.confirmationStatus === "finalized") {
    await recordFinalized(s);
  } else if (!status) {
    if (blockhashDead) await endSession(s.id, "expired", "Transaction did not land before its blockhash expired");
    else if (s.state === "submitting") await broadcast(s);
  }
  return (await getSession(s.id))!;
}

async function recordFinalized(s: SessionRow) {
  const conn = rpc();
  const tx = await conn.getTransaction(s.tx_signature!, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!tx) return;
  const terms = deserializeTerms(s.terms);
  const result = reconcileSettlement(tx, fromBase64(s.message_b64), terms);
  if (!result.ok) {
    // Funds moved but did not match: never mark filled, never reopen. Needs review.
    must(await db().from("settlement_sessions").update({ state: "failed", error: `Reconciliation mismatch: ${result.errors.join("; ")}` }).eq("id", s.id));
    await audit("otc.reconcile_mismatch", null, s.id, { errors: result.errors });
    return;
  }
  must(
    await db().rpc("otc_record_settlement", {
      p_settlement: {
        tx_signature: s.tx_signature,
        session_id: s.id,
        order_hash: s.order_hash,
        network: s.network,
        buyer: terms.buyer,
        seller: terms.seller,
        mint: terms.mint,
        token_amount: terms.tokenAmount.toString(),
        gross_lamports: terms.grossLamports.toString(),
        fee_lamports: terms.feeLamports.toString(),
        seller_net_lamports: terms.sellerNetLamports.toString(),
        treasury: terms.treasury,
        slot: result.slot,
        block_time: result.blockTime ? new Date(result.blockTime * 1000).toISOString() : null,
        reconciliation: {
          tokenDeltaSeller: result.tokenDeltaSeller.toString(),
          tokenDeltaBuyer: result.tokenDeltaBuyer.toString(),
          lamportDeltaSeller: result.lamportDeltaSeller.toString(),
          lamportDeltaTreasury: result.lamportDeltaTreasury.toString(),
          lamportDeltaBuyer: result.lamportDeltaBuyer.toString(),
          networkFeeLamports: result.networkFeeLamports.toString(),
          messageSha256: s.message_sha256,
        },
      },
    }),
  );
  await audit("otc.settled", null, s.id, { tx: s.tx_signature });
}

export function decodeMessageSummary(b64: string) {
  const m = VersionedMessage.deserialize(fromBase64(b64));
  return {
    accounts: m.staticAccountKeys.map((k) => k.toBase58()),
    instructions: m.compiledInstructions.length,
    requiredSignatures: m.header.numRequiredSignatures,
  };
}
