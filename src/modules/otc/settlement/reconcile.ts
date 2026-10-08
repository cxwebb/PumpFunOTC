/**
 * Reconcile a landed settlement against the agreed terms using only chain
 * data. A settlement is recorded as filled only when this returns ok.
 */
import { VersionedMessage, type VersionedTransactionResponse } from "@solana/web3.js";
import { bytesEqual } from "@/lib/encoding";
import type { SettlementTerms } from "./terms";

export interface ReconcileResult {
  ok: boolean;
  errors: string[];
  slot: number;
  blockTime: number | null;
  tokenDeltaSeller: bigint;
  tokenDeltaBuyer: bigint;
  lamportDeltaSeller: bigint;
  lamportDeltaTreasury: bigint;
  lamportDeltaBuyer: bigint;
  networkFeeLamports: bigint;
}

type TokenBalance = NonNullable<NonNullable<VersionedTransactionResponse["meta"]>["preTokenBalances"]>[number];

function tokenAmountFor(balances: TokenBalance[] | null | undefined, owner: string, mint: string): bigint {
  let total = 0n;
  for (const b of balances ?? []) {
    if (b.owner === owner && b.mint === mint) total += BigInt(b.uiTokenAmount.amount);
  }
  return total;
}

export function reconcileSettlement(
  tx: VersionedTransactionResponse,
  expectedMessage: Uint8Array,
  terms: SettlementTerms,
): ReconcileResult {
  const errors: string[] = [];
  const meta = tx.meta;
  const message = tx.transaction.message as VersionedMessage;
  if (!meta) errors.push("Transaction metadata unavailable");
  if (meta?.err) errors.push(`Transaction failed on chain: ${JSON.stringify(meta.err)}`);
  if (!bytesEqual(message.serialize(), expectedMessage)) errors.push("Landed transaction is not the agreed message");

  const keys = message.staticAccountKeys.map((k) => k.toBase58());
  const lamportDelta = (addr: string) => {
    const i = keys.indexOf(addr);
    if (i < 0 || !meta) return 0n;
    return BigInt(meta.postBalances[i]) - BigInt(meta.preBalances[i]);
  };

  const tokenDeltaSeller =
    tokenAmountFor(meta?.postTokenBalances, terms.seller, terms.mint) - tokenAmountFor(meta?.preTokenBalances, terms.seller, terms.mint);
  const tokenDeltaBuyer =
    tokenAmountFor(meta?.postTokenBalances, terms.buyer, terms.mint) - tokenAmountFor(meta?.preTokenBalances, terms.buyer, terms.mint);
  const lamportDeltaSeller = lamportDelta(terms.seller);
  const lamportDeltaTreasury = lamportDelta(terms.treasury);
  const lamportDeltaBuyer = lamportDelta(terms.buyer);

  if (tokenDeltaSeller !== -terms.tokenAmount) errors.push("Seller token balance did not decrease by the agreed amount");
  if (tokenDeltaBuyer !== terms.tokenAmount) errors.push("Buyer token balance did not increase by the agreed amount");
  if (lamportDeltaSeller !== terms.sellerNetLamports) errors.push("Seller SOL did not increase by price minus fee");
  if (terms.feeLamports > 0n && lamportDeltaTreasury !== terms.feeLamports) errors.push("Treasury did not receive the agreed fee");

  return {
    ok: errors.length === 0,
    errors,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    tokenDeltaSeller,
    tokenDeltaBuyer,
    lamportDeltaSeller,
    lamportDeltaTreasury,
    lamportDeltaBuyer,
    networkFeeLamports: BigInt(meta?.fee ?? 0),
  };
}
