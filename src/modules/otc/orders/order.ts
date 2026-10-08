/**
 * OTC order protocol v1.
 *
 * An order is an off-chain message signed by the maker's wallet. It moves no
 * funds. Its identity is the SHA-256 of its canonical JSON. Anyone can rebuild
 * the signed text from the order and check the maker's Ed25519 signature.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import nacl from "tweetnacl";
import { z } from "zod";
import { formatRaw, formatSol, parseRaw } from "@/lib/amounts";
import { base58, toHex } from "@/lib/encoding";
import { hexSchema, pubkeySchema, rawAmountSchema } from "@/lib/validation";

export const ORDER_VERSION = 1 as const;
export const SUPPORTED_TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()] as const;

export const orderSchema = z
  .object({
    version: z.literal(ORDER_VERSION),
    domain: z.string().min(1).max(100),
    network: z.enum(["devnet", "mainnet-beta"]),
    /** sell = maker sells tokens for SOL (ask); buy = maker buys tokens with SOL (bid). */
    side: z.enum(["sell", "buy"]),
    maker: pubkeySchema,
    /** null = public offer; otherwise only this wallet may take it. */
    counterparty: pubkeySchema.nullable(),
    mint: pubkeySchema,
    tokenProgram: z.enum(SUPPORTED_TOKEN_PROGRAMS),
    decimals: z.number().int().min(0).max(18),
    /** Raw token base units. */
    tokenAmount: rawAmountSchema,
    /** Gross SOL price in lamports for the whole tokenAmount. */
    lamports: rawAmountSchema,
    /** Platform fee in bps, deducted from the seller's SOL proceeds. */
    feeBps: z.number().int().min(0).max(1000),
    /** Fee destination. Must equal the platform's published treasury. */
    treasury: pubkeySchema,
    /** v1 supports only all-or-nothing fills. */
    partialFill: z.literal("none"),
    /** Hash of the order this counters, or null for an original offer. */
    parentHash: hexSchema(32).nullable(),
    /** Unix seconds. */
    expiresAt: z.number().int().positive(),
    /** 16 random bytes, hex. Makes every order unique. */
    nonce: hexSchema(16),
  })
  .strict();

export type Order = z.infer<typeof orderSchema>;

/** Deterministic JSON: object keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Non-integer number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

export function orderHash(order: Order): string {
  return toHex(sha256(new TextEncoder().encode(canonicalJson(orderSchema.parse(order)))));
}

/** The exact text the maker's wallet signs. Fully derived from the order. */
export function orderSigningMessage(order: Order): string {
  const o = orderSchema.parse(order);
  const hash = orderHash(o);
  const tokens = formatRaw(parseRaw(o.tokenAmount), o.decimals);
  const sol = formatSol(parseRaw(o.lamports));
  const action = o.side === "sell" ? "SELL" : "BUY";
  const lines = [
    `${o.domain} OTC order v${o.version}`,
    "",
    "Signing this message creates an off-chain OTC order.",
    "It is not a transaction and does not move funds.",
    "",
    `Network: ${o.network}`,
    `Side: ${action}`,
    `Token: ${o.mint}`,
    `Amount: ${tokens} (raw ${o.tokenAmount}, ${o.decimals} decimals)`,
    `Price: ${sol} SOL (${o.lamports} lamports)`,
    `Platform fee: ${o.feeBps} bps, paid from seller proceeds to ${o.treasury}`,
    `Counterparty: ${o.counterparty ?? "anyone"}`,
    `Partial fills: ${o.partialFill}`,
    `Counter to: ${o.parentHash ?? "none"}`,
    `Expires: ${new Date(o.expiresAt * 1000).toISOString()}`,
    `Nonce: ${o.nonce}`,
    "",
    `Order hash: ${hash}`,
  ];
  return lines.join("\n");
}

export function verifyDetachedSignature(message: string | Uint8Array, signatureB58: string, signer: string): boolean {
  try {
    const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
    const sig = base58.decode(signatureB58);
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(msg, sig, new PublicKey(signer).toBytes());
  } catch {
    return false;
  }
}

export function verifyOrderSignature(order: Order, signatureB58: string): boolean {
  return verifyDetachedSignature(orderSigningMessage(order), signatureB58, order.maker);
}

/** Who sells tokens and who buys them if `taker` takes `order`. */
export function settlementParties(order: Order, taker: string): { seller: string; buyer: string } {
  return order.side === "sell" ? { seller: order.maker, buyer: taker } : { seller: taker, buyer: order.maker };
}

export interface CounterCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Rules for a counteroffer `counter` against `parent`:
 * same token terms, opposite side, addressed to the parent maker,
 * made by the parent's counterparty (or anyone, if the parent was public).
 */
export function checkCounter(parent: Order, parentHashValue: string, counter: Order): CounterCheck {
  if (counter.parentHash !== parentHashValue) return { ok: false, reason: "Counter must reference the parent hash" };
  if (counter.mint !== parent.mint || counter.tokenProgram !== parent.tokenProgram || counter.decimals !== parent.decimals)
    return { ok: false, reason: "Counter must be for the same token" };
  if (counter.side === parent.side) return { ok: false, reason: "Counter must be the opposite side" };
  if (counter.counterparty !== parent.maker) return { ok: false, reason: "Counter must be addressed to the parent maker" };
  if (counter.maker === parent.maker) return { ok: false, reason: "Cannot counter your own order" };
  if (parent.counterparty !== null && parent.counterparty !== counter.maker)
    return { ok: false, reason: "Only the addressed counterparty can counter a private order" };
  if (counter.network !== parent.network || counter.domain !== parent.domain)
    return { ok: false, reason: "Counter must be on the same network and domain" };
  return { ok: true };
}

export function cancelMessage(params: { domain: string; network: string; orderHash: string; maker: string; issuedAt: string }): string {
  return [
    `${params.domain} OTC cancel`,
    "",
    "Signing this message cancels your OTC order. It does not move funds.",
    "A settlement transaction you already signed stays valid until its blockhash expires.",
    "",
    `Network: ${params.network}`,
    `Order hash: ${params.orderHash}`,
    `Maker: ${params.maker}`,
    `Issued At: ${params.issuedAt}`,
  ].join("\n");
}
