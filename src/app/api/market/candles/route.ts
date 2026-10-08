import { z } from "zod";
import { handle, json } from "@/server/http";
import { pubkeySchema } from "@/lib/validation";
import { getCandles } from "@/modules/market-data/geckoterminal";

const query = z.object({
  pool: pubkeySchema,
  tf: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("5m"),
});
const MAP = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1] } as const;

export const GET = handle(async (req) => {
  const { pool, tf } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const [timeframe, aggregate] = MAP[tf];
  return json({ candles: await getCandles(pool, timeframe, aggregate), source: "geckoterminal", network: "mainnet-beta" });
});
