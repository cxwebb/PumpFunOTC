import { z } from "zod";
import { pubkeySchema } from "@/lib/validation";
import { handle, json } from "@/server/http";
import { db, must } from "@/server/supabase";

const query = z.object({ creator: pubkeySchema.optional() });

/** Tokens launched through this platform (confirmed on chain). */
export const GET = handle(async (req) => {
  const { creator } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  let q = db().from("launches").select("*").eq("status", "confirmed").order("confirmed_at", { ascending: false }).limit(50);
  if (creator) q = q.eq("creator", creator);
  return json({ launches: must(await q) });
});
