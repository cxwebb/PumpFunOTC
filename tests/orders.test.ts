import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  checkCounter,
  orderHash,
  orderSchema,
  verifyOrderSignature,
} from "@/modules/otc/orders/order";
import { makeOrder, signOrder } from "./helpers";

const maker = Keypair.generate();
const taker = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();

describe("order protocol", () => {
  it("canonical JSON sorts keys and is stable", () => {
    expect(canonicalJson({ b: 1, a: { d: "x", c: null } })).toBe('{"a":{"c":null,"d":"x"},"b":1}');
  });

  it("hash is deterministic and changes with any field", () => {
    const o = makeOrder({ maker: maker.publicKey.toBase58(), mint });
    const shuffled = Object.fromEntries(Object.entries(o).reverse()) as typeof o;
    expect(orderHash(shuffled)).toBe(orderHash(o));
    expect(orderHash({ ...o, lamports: "2000000001" })).not.toBe(orderHash(o));
  });

  it("verifies maker signature and rejects tampering", () => {
    const o = makeOrder({ maker: maker.publicKey.toBase58(), mint });
    const sig = signOrder(o, maker);
    expect(verifyOrderSignature(o, sig)).toBe(true);
    expect(verifyOrderSignature({ ...o, tokenAmount: "1" }, sig)).toBe(false);
    expect(verifyOrderSignature(o, signOrder(o, taker))).toBe(false);
  });

  it("rejects malformed orders", () => {
    const o = makeOrder({ maker: maker.publicKey.toBase58(), mint });
    expect(orderSchema.safeParse({ ...o, lamports: "0" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...o, lamports: "1.5" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...o, extra: 1 }).success).toBe(false);
    expect(orderSchema.safeParse({ ...o, maker: "not-a-key" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...o, partialFill: "any" }).success).toBe(false);
  });

  it("enforces counteroffer rules", () => {
    const parent = makeOrder({ maker: maker.publicKey.toBase58(), mint });
    const h = orderHash(parent);
    const counter = makeOrder({
      maker: taker.publicKey.toBase58(),
      mint,
      side: "buy",
      counterparty: maker.publicKey.toBase58(),
      parentHash: h,
      lamports: "1800000000",
    });
    expect(checkCounter(parent, h, counter).ok).toBe(true);
    expect(checkCounter(parent, h, { ...counter, side: "sell" }).ok).toBe(false);
    expect(checkCounter(parent, h, { ...counter, counterparty: null }).ok).toBe(false);
    expect(checkCounter(parent, h, { ...counter, maker: maker.publicKey.toBase58() }).ok).toBe(false);
    const privateParent = { ...parent, counterparty: Keypair.generate().publicKey.toBase58() };
    expect(checkCounter(privateParent, orderHash(privateParent), { ...counter, parentHash: orderHash(privateParent) }).ok).toBe(false);
  });
});
