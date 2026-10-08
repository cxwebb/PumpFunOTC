import { z } from "zod";
import { handle, json } from "@/server/http";
import { isPublicKey } from "@/lib/validation";
import { getToken, search } from "@/modules/market-data/dexscreener";

const query = z.object({ q: z.string().trim().min(1).max(64) });

export const GET = handle(async (req) => {
  const { q } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  if (isPublicKey(q)) {
    const t = await getToken(q).catch(() => null);
    return json({ results: t ? [t] : [], address: q });
  }
  return json({ results: (await search(q)).slice(0, 30), address: null });
});
