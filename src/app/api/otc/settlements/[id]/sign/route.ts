import { z } from "zod";
import { signatureSchema } from "@/lib/validation";
import { handle, json, readJson } from "@/server/http";
import { submitSignature } from "@/server/otc";
import { requireWallet } from "@/server/session";

const body = z.object({ signature: signatureSchema });

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  const wallet = await requireWallet();
  const { signature } = body.parse(await readJson(req));
  const session = await submitSignature(id, wallet, signature);
  return json({ session });
});
