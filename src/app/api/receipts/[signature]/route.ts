import { HttpError, handle, json } from "@/server/http";
import { buildReceipt } from "@/server/receipts";

export const GET = handle<{ params: Promise<{ signature: string }> }>(async (_req, { params }) => {
  const { signature } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new HttpError(400, "Invalid transaction signature");
  return json({ receipt: await buildReceipt(signature) });
});
