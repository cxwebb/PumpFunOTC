import { HttpError, handle, json } from "@/server/http";
import { advanceSession, getOrderRow, getSession } from "@/server/otc";
import { currentWallet } from "@/server/session";

export const GET = handle<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  const viewer = await currentWallet().catch(() => null);
  let session = await getSession(id);
  if (!session || (viewer !== session.buyer && viewer !== session.seller)) throw new HttpError(404, "Settlement not found");
  session = await advanceSession(session);
  const order = await getOrderRow(session.order_hash);
  return json({ session, order, viewer });
});
