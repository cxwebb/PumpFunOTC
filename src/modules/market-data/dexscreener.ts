/**
 * DexScreener public API (no key). Documented at docs.dexscreener.com/api/reference.
 * Mainnet data only. Responses are validated loosely and normalized; any
 * field that is absent is returned as null rather than guessed.
 */
import { z } from "zod";
import type { MarketToken } from "./types";

const BASE = "https://api.dexscreener.com";
const num = z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === undefined || v === null || v === "" ? null : Number(v)));

const pairSchema = z
  .object({
    chainId: z.string(),
    dexId: z.string().optional().nullable(),
    pairAddress: z.string().optional().nullable(),
    baseToken: z.object({ address: z.string(), name: z.string().optional().nullable(), symbol: z.string().optional().nullable() }),
    quoteToken: z.object({ address: z.string().optional().nullable(), symbol: z.string().optional().nullable() }).optional().nullable(),
    priceNative: num,
    priceUsd: num,
    txns: z.record(z.string(), z.object({ buys: z.number().optional(), sells: z.number().optional() }).passthrough()).optional().nullable(),
    volume: z.record(z.string(), z.number()).optional().nullable(),
    priceChange: z.record(z.string(), z.number()).optional().nullable(),
    liquidity: z.object({ usd: num }).passthrough().optional().nullable(),
    fdv: num,
    marketCap: num,
    pairCreatedAt: num,
    info: z.object({ imageUrl: z.string().optional().nullable() }).passthrough().optional().nullable(),
  })
  .passthrough();
type Pair = z.infer<typeof pairSchema>;

const SOL_MINT = "So11111111111111111111111111111111111111112";

async function get(path: string, revalidate = 30): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate }, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`DexScreener ${res.status} for ${path}`);
  return res.json();
}

function parsePairs(data: unknown): Pair[] {
  const arr = Array.isArray(data) ? data : ((data as { pairs?: unknown[] })?.pairs ?? []);
  const out: Pair[] = [];
  for (const p of arr) {
    const r = pairSchema.safeParse(p);
    if (r.success && r.data.chainId === "solana") out.push(r.data);
  }
  return out;
}

/** Pick the most liquid SOL-quoted pair per base mint. */
function bestPairs(pairs: Pair[]): Map<string, Pair> {
  const best = new Map<string, Pair>();
  for (const p of pairs) {
    if (p.quoteToken?.address && p.quoteToken.address !== SOL_MINT) continue;
    const mint = p.baseToken.address;
    const cur = best.get(mint);
    if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(mint, p);
  }
  return best;
}

function normalize(p: Pair): MarketToken {
  return {
    mint: p.baseToken.address,
    name: p.baseToken.name ?? null,
    symbol: p.baseToken.symbol ?? null,
    imageUrl: p.info?.imageUrl ?? null,
    priceUsd: p.priceUsd,
    priceSol: p.priceNative,
    marketCapUsd: p.marketCap ?? p.fdv,
    liquidityUsd: p.liquidity?.usd ?? null,
    volume24hUsd: p.volume?.h24 ?? null,
    priceChange24hPct: p.priceChange?.h24 ?? null,
    buys24h: p.txns?.h24?.buys ?? null,
    sells24h: p.txns?.h24?.sells ?? null,
    venue: p.dexId ?? null,
    pairAddress: p.pairAddress ?? null,
    pairCreatedAt: p.pairCreatedAt,
    source: "dexscreener",
    network: "mainnet-beta",
  };
}

/** Market data for up to 30 mints per request. */
export async function getTokens(mints: string[]): Promise<MarketToken[]> {
  const unique = Array.from(new Set(mints)).slice(0, 90);
  const out: MarketToken[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const pairs = parsePairs(await get(`/tokens/v1/solana/${chunk.join(",")}`));
    for (const p of bestPairs(pairs).values()) out.push(normalize(p));
  }
  return out;
}

export async function getToken(mint: string): Promise<MarketToken | null> {
  return (await getTokens([mint]))[0] ?? null;
}

export async function search(query: string): Promise<MarketToken[]> {
  const pairs = parsePairs(await get(`/latest/dex/search?q=${encodeURIComponent(query)}`, 15));
  return Array.from(bestPairs(pairs).values()).map(normalize);
}

const profileSchema = z.object({ chainId: z.string(), tokenAddress: z.string() }).passthrough();

async function solanaAddressesFrom(path: string): Promise<string[]> {
  const data = await get(path, 60);
  const arr = Array.isArray(data) ? data : [];
  return arr
    .map((x) => profileSchema.safeParse(x))
    .filter((r) => r.success && r.data.chainId === "solana")
    .map((r) => (r as { data: { tokenAddress: string } }).data.tokenAddress);
}

/** Recently listed token profiles on Solana, optionally Pump mints only. */
export async function latestTokens(pumpOnly = true): Promise<MarketToken[]> {
  const addrs = await solanaAddressesFrom("/token-profiles/latest/v1");
  return getTokens(pumpOnly ? addrs.filter((a) => a.endsWith("pump")) : addrs);
}

/** Most boosted Solana tokens right now (DexScreener's trending signal). */
export async function trendingTokens(): Promise<MarketToken[]> {
  const addrs = await solanaAddressesFrom("/token-boosts/top/v1");
  return getTokens(addrs);
}
