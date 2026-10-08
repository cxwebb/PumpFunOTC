import { z } from "zod";
import { pubkeySchema, rawAmountSchema } from "@/lib/validation";
import { HttpError, handle, json, jsonSafe, readJson } from "@/server/http";
import { buildTrade } from "@/server/pump";
import { requireWallet } from "@/server/session";

const body = z.object({
  mint: pubkeySchema,
  side: z.enum(["buy", "sell"]),
  amount: rawAmountSchema,
  slippagePct: z.number().positive().max(50),
});

/** Unsigned Pump curve / PumpSwap trade for the signed-in wallet. No platform fee. */
export const POST = handle(async (req) => {
  const user = await requireWallet();
  const b = body.parse(await readJson(req));
  const result = await buildTrade({ mint: b.mint, user, side: b.side, amount: BigInt(b.amount), slippagePct: b.slippagePct });
  if (result.simulation.err) throw new HttpError(422, "Simulation failed; the trade would not succeed right now", result.simulation);
  return json(jsonSafe(result));
});
