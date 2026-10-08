/** GeckoTerminal public OHLCV API (no key). Mainnet only. */
import type { Candle } from "./types";

export type Timeframe = "minute" | "hour" | "day";

export async function getCandles(pool: string, timeframe: Timeframe, aggregate: number, limit = 300): Promise<Candle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`;
  const res = await fetch(url, { next: { revalidate: 30 }, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  const list = body.data?.attributes?.ohlcv_list ?? [];
  return list
    .filter((r) => Array.isArray(r) && r.length >= 6 && r.every((v) => Number.isFinite(Number(v))))
    .map(([time, open, high, low, close, volume]) => ({ time: Number(time), open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) }))
    .sort((a, b) => a.time - b.time);
}
