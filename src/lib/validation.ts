import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

export function isPublicKey(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

export const pubkeySchema = z.string().refine(isPublicKey, "Invalid Solana address");
export const rawAmountSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Must be a positive integer string")
  .refine((v) => /^\d+$/.test(v) && BigInt(v) <= (1n << 64n) - 1n, "Exceeds u64");
export const hexSchema = (bytes: number) =>
  z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), `Expected ${bytes}-byte lowercase hex`);
export const signatureSchema = z.string().min(64).max(100); // base58 Ed25519 signature
