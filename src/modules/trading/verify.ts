/**
 * Browser-side checks on a server-built Pump / PumpSwap / launch transaction
 * before the wallet is asked to sign it. The wallet's own simulation is the
 * second line of defense; this one guards against a compromised server.
 */
import { Buffer } from "buffer";
import { PublicKey, SystemInstruction, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TRADE_PROGRAM_ALLOWLIST } from "./programs";

export function verifyTradeTransaction(
  tx: VersionedTransaction,
  user: string,
  opts: { extraSigners?: string[]; maxLamportsOut?: bigint } = {},
): string[] {
  const errors: string[] = [];
  const m = tx.message;
  const keys = m.staticAccountKeys;
  if (m.addressTableLookups.length > 0) errors.push("Address lookup tables are not allowed");
  if (keys[0]?.toBase58() !== user) errors.push("Fee payer must be your wallet");
  const signers = keys.slice(0, m.header.numRequiredSignatures).map((k) => k.toBase58());
  const allowedSigners = new Set([user, ...(opts.extraSigners ?? [])]);
  for (const s of signers) if (!allowedSigners.has(s)) errors.push(`Unexpected signer ${s}`);

  const userKey = new PublicKey(user);
  // The only SOL a trade moves at top level is wrapping into the user's own WSOL account.
  const wsolAtas = new Set([getAssociatedTokenAddressSync(NATIVE_MINT, userKey, false).toBase58()]);
  let lamportsOut = 0n;
  for (const ci of m.compiledInstructions) {
    const programId = keys[ci.programIdIndex];
    if (!programId || !TRADE_PROGRAM_ALLOWLIST.has(programId.toBase58())) {
      errors.push(`Program not allowed: ${programId?.toBase58() ?? "unknown"}`);
      continue;
    }
    if (programId.equals(SystemProgram.programId)) {
      const ix = new TransactionInstruction({
        programId,
        keys: ci.accountKeyIndexes.map((i) => ({ pubkey: keys[i], isSigner: m.isAccountSigner(i), isWritable: m.isAccountWritable(i) })),
        data: Buffer.from(ci.data),
      });
      let type: string;
      try {
        type = SystemInstruction.decodeInstructionType(ix);
      } catch {
        errors.push("Undecodable System instruction");
        continue;
      }
      if (type === "Transfer") {
        const t = SystemInstruction.decodeTransfer(ix);
        if (!wsolAtas.has(t.toPubkey.toBase58())) errors.push(`SOL transfer to an unexpected address: ${t.toPubkey.toBase58()}`);
        lamportsOut += t.lamports;
      } else if (type !== "Create" && type !== "CreateWithSeed") {
        errors.push(`Unexpected System instruction: ${type}`);
      }
    }
  }
  if (opts.maxLamportsOut !== undefined && lamportsOut > opts.maxLamportsOut) errors.push("Transaction moves more SOL than the quote");
  return errors;
}
