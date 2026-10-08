import { handle, json } from "@/server/http";
import { acceptOrder } from "@/server/otc";
import { requireWallet } from "@/server/session";

export const POST = handle<{ params: Promise<{ hash: string }> }>(async (_req, { params }) => {
  const { hash } = await params;
  const taker = await requireWallet();
  const session = await acceptOrder(hash, taker);
  return json({ session }, 201);
});
