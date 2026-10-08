import "server-only";
import { z } from "zod";
import { OTC_TREASURY } from "@/lib/config";

const schema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  SOLANA_RPC_URL: z.string().url().optional(),
  PINATA_JWT: z.string().min(1).optional(),
  PINATA_GATEWAY: z.string().optional(),
  OTC_TREASURY: z.string().optional(),
});

export const serverEnv = schema.parse({
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  SESSION_SECRET: process.env.SESSION_SECRET || undefined,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || undefined,
  PINATA_JWT: process.env.PINATA_JWT || undefined,
  PINATA_GATEWAY: process.env.PINATA_GATEWAY || undefined,
  OTC_TREASURY: process.env.OTC_TREASURY || undefined,
});

/** Thrown when a feature needs configuration that is missing. Mapped to HTTP 503. */
export class NotConfiguredError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Server is missing configuration: ${variables.join(", ")}`);
  }
}

export function requireEnv<K extends keyof typeof serverEnv>(...keys: K[]): { [P in K]: NonNullable<(typeof serverEnv)[P]> } {
  const missing = keys.filter((k) => !serverEnv[k]);
  if (missing.length) throw new NotConfiguredError(missing as string[]);
  return Object.fromEntries(keys.map((k) => [k, serverEnv[k]])) as { [P in K]: NonNullable<(typeof serverEnv)[P]> };
}

/**
 * The treasury the server builds settlements with. The public and server
 * values must agree, so a browser and the server can never disagree on
 * where fees go.
 */
export function treasuryAddress(): string {
  if (!OTC_TREASURY) throw new NotConfiguredError(["NEXT_PUBLIC_OTC_TREASURY"]);
  if (serverEnv.OTC_TREASURY && serverEnv.OTC_TREASURY !== OTC_TREASURY)
    throw new Error("OTC_TREASURY and NEXT_PUBLIC_OTC_TREASURY disagree. Refusing to build settlements.");
  return OTC_TREASURY;
}
