import { HttpError, handle, json } from "@/server/http";
import { canView, getOrderRow, orderChain } from "@/server/otc";
import { currentWallet } from "@/server/session";
import { db, must } from "@/server/supabase";

export const GET = handle<{ params: Promise<{ hash: string }> }>(async (_req, { params }) => {
  const { hash } = await params;
  const viewer = await currentWallet().catch(() => null);
  const order = await getOrderRow(hash);
  if (!order || !canView(order, viewer)) throw new HttpError(404, "Order not found");
  const chain = await orderChain(order.root_hash, viewer);
  const sessions = must(
    await db()
      .from("settlement_sessions")
      .select("id,state,buyer,seller,tx_signature,error,created_at")
      .eq("order_hash", hash)
      .order("created_at", { ascending: false })
      .limit(10),
  );
  return json({ order, chain, sessions, viewer });
});
