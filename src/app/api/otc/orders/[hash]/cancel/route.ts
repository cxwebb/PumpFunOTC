import { z } from "zod";
import { signatureSchema } from "@/lib/validation";
import { handle, json, readJson } from "@/server/http";
import { cancelOrder } from "@/server/otc";
import { requireWallet } from "@/server/session";

const body = z.object({ issuedAt: z.string(), signature: signatureSchema });

export const POST = handle<{ params: Promise<{ hash: string }> }>(async (req, { params }) => {
  const { hash } = await params;
  const wallet = await requireWallet();
  await cancelOrder(hash, wallet, body.parse(await readJson(req)));
  return json({ ok: true });
});
