import { z } from "zod";
import { CLUSTER } from "@/lib/config";
import { pubkeySchema } from "@/lib/validation";
import { HttpError, handle, json, jsonSafe, readJson } from "@/server/http";
import { buildLaunch } from "@/server/pump";
import { requireWallet } from "@/server/session";
import { db, must } from "@/server/supabase";

const body = z.object({
  mint: pubkeySchema,
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10),
  uri: z.string().url().max(200),
  initialBuyLamports: z.string().regex(/^\d+$/),
});

export const POST = handle(async (req) => {
  const user = await requireWallet();
  const b = body.parse(await readJson(req));
  const lamports = BigInt(b.initialBuyLamports);
  if (lamports > 100n * 1_000_000_000n) throw new HttpError(400, "Initial buy is capped at 100 SOL");
  const result = await buildLaunch({ ...b, user, initialBuyLamports: lamports });
  must(
    await db().from("launches").upsert({ mint: b.mint, network: CLUSTER, creator: user, name: b.name, symbol: b.symbol, metadata_uri: b.uri, status: "pending" }),
  );
  return json(jsonSafe(result));
});
