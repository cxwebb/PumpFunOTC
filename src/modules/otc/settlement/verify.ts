/**
 * Independent settlement verifier. Runs in the browser before every wallet
 * prompt and on the server before storing a signature and before broadcast.
 *
 * Two layers:
 *  1. Byte-exact comparison with a canonical rebuild from the signed order.
 *  2. A semantic decode of every instruction, so a builder bug cannot slip
 *     an unexpected transfer past layer 1.
 */
import { Buffer } from "buffer";
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  VersionedMessage,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { bytesEqual } from "@/lib/encoding";
import { buildSettlementMessageBytes, type SettlementBuildParams } from "./build";
import { MEMO_PROGRAM_ID, SETTLEMENT_PROGRAM_ALLOWLIST, settlementMemo } from "./programs";

export interface VerifyOptions {
  /** Highest priority fee the verifier accepts. */
  maxComputeUnitPriceMicroLamports: number;
  /** Treasury the verifier trusts (from its own config, never from the server response). */
  expectedTreasury: string;
  /** Highest fee rate the verifier accepts. */
  maxFeeBps: number;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

function decompile(message: VersionedMessage): TransactionInstruction[] {
  const keys = message.staticAccountKeys;
  return message.compiledInstructions.map(
    (ci) =>
      new TransactionInstruction({
        programId: keys[ci.programIdIndex],
        keys: ci.accountKeyIndexes.map((i) => ({
          pubkey: keys[i],
          isSigner: message.isAccountSigner(i),
          isWritable: message.isAccountWritable(i),
        })),
        data: Buffer.from(ci.data),
      }),
  );
}

export function verifySettlementMessage(messageBytes: Uint8Array, params: SettlementBuildParams, opts: VerifyOptions): VerifyResult {
  const errors: string[] = [];
  const { terms } = params;

  // Terms sanity, independent of the transaction.
  if (terms.treasury !== opts.expectedTreasury) errors.push("Fee destination is not the published treasury");
  if (terms.feeBps > opts.maxFeeBps) errors.push(`Fee ${terms.feeBps} bps exceeds the accepted maximum ${opts.maxFeeBps} bps`);
  if (terms.feeLamports + terms.sellerNetLamports !== terms.grossLamports) errors.push("Fee and seller proceeds do not add up to the price");
  if (terms.buyer === terms.seller) errors.push("Buyer and seller must be different wallets");
  if (params.computeUnitPriceMicroLamports > opts.maxComputeUnitPriceMicroLamports) errors.push("Priority fee is above the accepted maximum");

  let message: VersionedMessage;
  try {
    message = VersionedMessage.deserialize(messageBytes);
  } catch {
    return { ok: false, errors: [...errors, "Transaction message could not be decoded"] };
  }

  // Layer 1: canonical rebuild.
  let expected: Uint8Array | null = null;
  try {
    expected = buildSettlementMessageBytes(params);
  } catch (e) {
    errors.push(`Could not rebuild the expected transaction: ${(e as Error).message}`);
  }
  if (expected && !bytesEqual(expected, messageBytes)) errors.push("Transaction bytes differ from the canonical rebuild of the signed order");

  // Layer 2: structural and semantic checks.
  if (message.version !== 0) errors.push("Unexpected message version");
  if (message.addressTableLookups.length > 0) errors.push("Address lookup tables are not allowed");
  if (message.header.numRequiredSignatures !== 2) errors.push("Exactly two signers are required");
  const keys = message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== terms.buyer) errors.push("Fee payer / first signer must be the buyer");
  if (keys[1] !== terms.seller) errors.push("Second signer must be the seller");
  if (message.recentBlockhash !== params.recentBlockhash) errors.push("Blockhash mismatch");

  const ixs = decompile(message);
  const mint = new PublicKey(terms.mint);
  const tokenProgram = new PublicKey(terms.tokenProgram);
  const sellerAta = getAssociatedTokenAddressSync(mint, new PublicKey(terms.seller), false, tokenProgram);
  const buyerAta = getAssociatedTokenAddressSync(mint, new PublicKey(terms.buyer), false, tokenProgram);
  let tokenTransfers = 0;
  let toSeller = 0n;
  let toTreasury = 0n;
  let memoOk = false;

  for (const ix of ixs) {
    const pid = ix.programId.toBase58();
    if (!SETTLEMENT_PROGRAM_ALLOWLIST.has(pid)) {
      errors.push(`Program not allowed: ${pid}`);
      continue;
    }
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const type = ComputeBudgetInstruction.decodeInstructionType(ix);
      if (type === "SetComputeUnitPrice") {
        const { microLamports } = ComputeBudgetInstruction.decodeSetComputeUnitPrice(ix);
        if (BigInt(microLamports) > BigInt(opts.maxComputeUnitPriceMicroLamports)) errors.push("Priority fee too high");
      } else if (type !== "SetComputeUnitLimit") {
        errors.push(`Unexpected compute budget instruction: ${type}`);
      }
    } else if (ix.programId.equals(MEMO_PROGRAM_ID)) {
      memoOk = ix.data.toString("utf8") === settlementMemo(params.orderHash, params.settlementId) && ix.keys.length === 0;
      if (!memoOk) errors.push("Memo does not match this order and settlement");
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // CreateIdempotent (data [1]) for the buyer's ATA, paid by the buyer.
      const [payer, ata, owner, ixMint, , ixTokenProgram] = ix.keys.map((k) => k.pubkey.toBase58());
      if (ix.data.length !== 1 || ix.data[0] !== 1) errors.push("Only idempotent ATA creation is allowed");
      if (payer !== terms.buyer || ata !== buyerAta.toBase58() || owner !== terms.buyer || ixMint !== terms.mint || ixTokenProgram !== terms.tokenProgram)
        errors.push("ATA creation does not match the buyer's token account");
    } else if (ix.programId.equals(SystemProgram.programId)) {
      let type: string;
      try {
        type = SystemInstruction.decodeInstructionType(ix);
      } catch {
        errors.push("Undecodable System instruction");
        continue;
      }
      if (type !== "Transfer") {
        errors.push(`Unexpected System instruction: ${type}`);
        continue;
      }
      const t = SystemInstruction.decodeTransfer(ix);
      const from = t.fromPubkey.toBase58();
      const to = t.toPubkey.toBase58();
      if (from !== terms.buyer) errors.push("SOL may only be sent by the buyer");
      if (to === terms.seller) toSeller += t.lamports;
      else if (to === terms.treasury) toTreasury += t.lamports;
      else errors.push(`SOL sent to an unexpected address: ${to}`);
    } else if (ix.programId.equals(tokenProgram)) {
      let decoded;
      try {
        decoded = decodeTransferCheckedInstruction(ix, tokenProgram);
      } catch {
        errors.push("Only a TransferChecked token instruction is allowed");
        continue;
      }
      tokenTransfers++;
      const { source, mint: m, destination, owner } = decoded.keys;
      if (source.pubkey.toBase58() !== sellerAta.toBase58()) errors.push("Tokens must come from the seller's token account");
      if (destination.pubkey.toBase58() !== buyerAta.toBase58()) errors.push("Tokens must go to the buyer's token account");
      if (m.pubkey.toBase58() !== terms.mint) errors.push("Token mint mismatch");
      if (owner.pubkey.toBase58() !== terms.seller) errors.push("Token transfer must be authorized by the seller");
      if (decoded.keys.multiSigners.length > 0) errors.push("Multisig token authorities are not supported");
      if (decoded.data.amount !== terms.tokenAmount) errors.push("Token amount mismatch");
      if (decoded.data.decimals !== terms.decimals) errors.push("Token decimals mismatch");
    } else {
      errors.push(`Unexpected program for this token: ${pid}`);
    }
  }

  if (tokenTransfers !== 1) errors.push("Exactly one token transfer is required");
  if (!memoOk) errors.push("Settlement memo missing");
  if (toSeller !== terms.sellerNetLamports) errors.push("SOL to seller does not equal price minus fee");
  if (toTreasury !== terms.feeLamports) errors.push("Fee amount mismatch");

  return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
}
