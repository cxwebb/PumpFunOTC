import { z } from "zod";
import { pubkeySchema, signatureSchema } from "@/lib/validation";
import { handle, json, readJson } from "@/server/http";
import { createOrder, listOrders } from "@/server/otc";
import { currentWallet, requireWallet } from "@/server/session";

const query = z.object({
  mint: pubkeySchema.optional(),
  side: z.enum(["sell", "buy"]).optional(),
  status: z.enum(["open", "settling", "countered", "cancelled", "filled", "expired", "all"]).optional(),
  maker: pubkeySchema.optional(),
  involving: pubkeySchema.optional(),
});

export const GET = handle(async (req) => {
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await currentWallet().catch(() => null);
  const orders = await listOrders({ ...params, status: params.status ?? "open", viewer });
  return json({ orders });
});

const body = z.object({ order: z.unknown(), signature: signatureSchema });

export const POST = handle(async (req) => {
  const wallet = await requireWallet();
  const input = body.parse(await readJson(req));
  const order = await createOrder(input, wallet);
  return json({ order }, 201);
});
