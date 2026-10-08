import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** The only programs a settlement transaction may invoke. */
export const SETTLEMENT_PROGRAM_ALLOWLIST = new Set<string>([
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  MEMO_PROGRAM_ID.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
]);

export const MEMO_PREFIX = "otc-settlement:v1";

export function settlementMemo(orderHash: string, settlementId: string): string {
  return `${MEMO_PREFIX}:${orderHash}:${settlementId}`;
}
