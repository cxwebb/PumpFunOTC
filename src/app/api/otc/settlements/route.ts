import { z } from "zod";
import { pubkeySchema } from "@/lib/validation";
import { handle, json } from "@/server/http";
import { requireWallet } from "@/server/session";
import { db, must } from "@/server/supabase";

const query = z.object({ state: z.enum(["active", "all"]).optional() });

/** Signing sessions the signed-in wallet is party to. */
export const GET = handle(async (req) => {
  const wallet = pubkeySchema.parse(await requireWallet());
  const { state } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  let q = db()
    .from("settlement_sessions")
    .select("id,order_hash,state,buyer,seller,terms,tx_signature,error,created_at")
    .or(`buyer.eq.${wallet},seller.eq.${wallet}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (state !== "all") q = q.in("state", ["awaiting_buyer", "awaiting_seller", "submitting", "submitted"]);
  return json({ sessions: must(await q) });
});
