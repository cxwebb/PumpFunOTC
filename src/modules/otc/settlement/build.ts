/**
 * Deterministic settlement transaction builder.
 *
 * The server builds the message once and stores its bytes. Each browser
 * rebuilds it from the signed order with this same function and compares
 * bytes before asking the wallet to sign. Any difference blocks signing.
 */
import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { MEMO_PROGRAM_ID, settlementMemo } from "./programs";
import type { SettlementTerms } from "./terms";

export interface SettlementBuildParams {
  terms: SettlementTerms;
  orderHash: string;
  settlementId: string;
  recentBlockhash: string;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
}

export function settlementTokenAccounts(terms: SettlementTerms) {
  const mint = new PublicKey(terms.mint);
  const tokenProgram = new PublicKey(terms.tokenProgram);
  const sellerAta = getAssociatedTokenAddressSync(mint, new PublicKey(terms.seller), false, tokenProgram);
  const buyerAta = getAssociatedTokenAddressSync(mint, new PublicKey(terms.buyer), false, tokenProgram);
  return { mint, tokenProgram, sellerAta, buyerAta };
}

export function buildSettlementInstructions(p: SettlementBuildParams): TransactionInstruction[] {
  const { terms } = p;
  const buyer = new PublicKey(terms.buyer);
  const seller = new PublicKey(terms.seller);
  const treasury = new PublicKey(terms.treasury);
  const { mint, tokenProgram, sellerAta, buyerAta } = settlementTokenAccounts(terms);

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: p.computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.computeUnitPriceMicroLamports }),
    createAssociatedTokenAccountIdempotentInstruction(buyer, buyerAta, buyer, mint, tokenProgram),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(settlementMemo(p.orderHash, p.settlementId), "utf8"),
    }),
    createTransferCheckedInstruction(sellerAta, mint, buyerAta, seller, terms.tokenAmount, terms.decimals, [], tokenProgram),
  ];
  if (terms.sellerNetLamports > 0n) {
    ixs.push(SystemProgram.transfer({ fromPubkey: buyer, toPubkey: seller, lamports: terms.sellerNetLamports }));
  }
  if (terms.feeLamports > 0n) {
    ixs.push(SystemProgram.transfer({ fromPubkey: buyer, toPubkey: treasury, lamports: terms.feeLamports }));
  }
  return ixs;
}

export function buildSettlementMessage(p: SettlementBuildParams): MessageV0 {
  return new TransactionMessage({
    payerKey: new PublicKey(p.terms.buyer),
    recentBlockhash: p.recentBlockhash,
    instructions: buildSettlementInstructions(p),
  }).compileToV0Message();
}

export function buildSettlementMessageBytes(p: SettlementBuildParams): Uint8Array {
  return buildSettlementMessage(p).serialize();
}
