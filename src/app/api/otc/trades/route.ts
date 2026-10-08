import { z } from "zod";
import { pubkeySchema } from "@/lib/validation";
import { handle, json } from "@/server/http";
import { db, must } from "@/server/supabase";

const query = z.object({ mint: pubkeySchema.optional(), wallet: pubkeySchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

/** Chain-verified settled trades (public receipts). */
export const GET = handle(async (req) => {
  const { mint, wallet, limit } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  let q = db().from("settlements").select("*").order("created_at", { ascending: false }).limit(limit ?? 25);
  if (mint) q = q.eq("mint", mint);
  if (wallet) q = q.or(`buyer.eq.${wallet},seller.eq.${wallet}`);
  return json({ trades: must(await q) });
});
