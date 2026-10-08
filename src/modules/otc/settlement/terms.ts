import { computeFee, parseRaw } from "@/lib/amounts";
import { type Order, settlementParties } from "@/modules/otc/orders/order";

/** Every number and address that goes into a settlement transaction. */
export interface SettlementTerms {
  buyer: string;
  seller: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  tokenAmount: bigint;
  grossLamports: bigint;
  feeLamports: bigint;
  sellerNetLamports: bigint;
  treasury: string;
  feeBps: number;
}

/** Derive settlement terms purely from a signed order and the taker. */
export function deriveSettlementTerms(order: Order, taker: string): SettlementTerms {
  if (taker === order.maker) throw new Error("Maker cannot take their own order");
  if (order.counterparty !== null && order.counterparty !== taker) throw new Error("Order is private to another wallet");
  const { buyer, seller } = settlementParties(order, taker);
  const grossLamports = parseRaw(order.lamports);
  const tokenAmount = parseRaw(order.tokenAmount);
  if (grossLamports === 0n || tokenAmount === 0n) throw new Error("Zero amounts are not allowed");
  const feeLamports = computeFee(grossLamports, order.feeBps);
  return {
    buyer,
    seller,
    mint: order.mint,
    tokenProgram: order.tokenProgram,
    decimals: order.decimals,
    tokenAmount,
    grossLamports,
    feeLamports,
    sellerNetLamports: grossLamports - feeLamports,
    treasury: order.treasury,
    feeBps: order.feeBps,
  };
}
