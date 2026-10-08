/**
 * Client-safe configuration. Every value here is public (NEXT_PUBLIC_*).
 * Next.js only inlines NEXT_PUBLIC_ variables accessed as literal
 * `process.env.NEXT_PUBLIC_X`, so keep the direct property reads.
 */
export type Cluster = "devnet" | "mainnet-beta";

const rawCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
const allowMainnet = process.env.NEXT_PUBLIC_ALLOW_MAINNET === "true";

function resolveCluster(): Cluster {
  if (rawCluster === "mainnet-beta" || rawCluster === "mainnet") {
    if (!allowMainnet) {
      throw new Error(
        "NEXT_PUBLIC_SOLANA_CLUSTER is mainnet but NEXT_PUBLIC_ALLOW_MAINNET is not 'true'. Mainnet requires explicit opt-in.",
      );
    }
    return "mainnet-beta";
  }
  if (rawCluster !== "devnet") {
    throw new Error(`Unsupported NEXT_PUBLIC_SOLANA_CLUSTER: ${rawCluster}`);
  }
  return "devnet";
}

export const CLUSTER: Cluster = resolveCluster();

export const PUBLIC_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");

export const APP_NAME = "PumpFunOTC";
export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || "localhost:3000";

/** OTC platform fee in basis points (50 = 0.5%). Hard ceiling of 1000 (10%). */
export const OTC_FEE_BPS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_OTC_FEE_BPS ?? "50");
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("NEXT_PUBLIC_OTC_FEE_BPS must be an integer 0..1000");
  return n;
})();

/** Published treasury that receives the OTC fee. Empty means OTC order creation is disabled. */
export const OTC_TREASURY = process.env.NEXT_PUBLIC_OTC_TREASURY || "";

/** Maximum priority fee the client accepts in a settlement transaction (micro-lamports per CU). */
export const MAX_CU_PRICE_MICROLAMPORTS = 200_000;
export const SETTLEMENT_CU_LIMIT = 80_000;

export const MAX_ORDER_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function explorerTxUrl(signature: string): string {
  const suffix = CLUSTER === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function explorerAddressUrl(address: string): string {
  const suffix = CLUSTER === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
