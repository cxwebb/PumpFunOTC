import { handle, json } from "@/server/http";
import { latestTokens, trendingTokens } from "@/modules/market-data/dexscreener";
import type { MarketToken } from "@/modules/market-data/types";

async function safe(fn: () => Promise<MarketToken[]>) {
  try {
    return { tokens: await fn(), error: null as string | null };
  } catch (e) {
    return { tokens: [] as MarketToken[], error: (e as Error).message };
  }
}

/** Discovery lists from DexScreener (Solana mainnet). */
export const GET = handle(async () => {
  const [trending, latest] = await Promise.all([safe(trendingTokens), safe(() => latestTokens(true))]);
  const pump = [...trending.tokens, ...latest.tokens];
  const curve = pump.filter((t) => t.venue === "pumpfun");
  const nearGraduation = [...curve].sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0)).slice(0, 20);
  const graduated = pump.filter((t) => t.venue === "pumpswap");
  return json({
    source: "dexscreener",
    network: "mainnet-beta",
    trending: trending.tokens,
    newLaunches: latest.tokens,
    nearGraduation,
    graduated,
    errors: [trending.error, latest.error].filter(Boolean),
  });
});
