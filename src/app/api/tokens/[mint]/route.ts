import { HttpError, handle, json } from "@/server/http";
import { isPublicKey } from "@/lib/validation";
import { getToken } from "@/modules/market-data/dexscreener";
import { chainTokenInfo } from "@/server/tokens";

export const GET = handle<{ params: Promise<{ mint: string }> }>(async (_req, { params }) => {
  const { mint } = await params;
  if (!isPublicKey(mint)) throw new HttpError(400, "Invalid mint address");
  const [chain, market] = await Promise.all([
    chainTokenInfo(mint),
    getToken(mint).catch((e: Error) => ({ error: e.message })),
  ]);
  return json({ chain, market });
});
