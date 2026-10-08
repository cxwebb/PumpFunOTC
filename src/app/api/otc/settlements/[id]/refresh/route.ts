import { HttpError, handle, json } from "@/server/http";
import { advanceSession, getSession } from "@/server/otc";

/** Anyone may nudge a session forward; it only reads chain state. */
export const POST = handle<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  const s = await getSession(id);
  if (!s) throw new HttpError(404, "Settlement not found");
  const next = await advanceSession(s);
  return json({ state: next.state, tx_signature: next.tx_signature });
});
