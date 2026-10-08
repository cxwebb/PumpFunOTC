import { z } from "zod";
import { pubkeySchema, signatureSchema } from "@/lib/validation";
import { verifyDetachedSignature } from "@/modules/otc/orders/order";
import { HttpError, handle, json, readJson } from "@/server/http";
import { createSession } from "@/server/session";
import { audit, db, must } from "@/server/supabase";

const body = z.object({ wallet: pubkeySchema, nonce: z.string().regex(/^[0-9a-f]{32}$/), signature: signatureSchema });

export const POST = handle(async (req) => {
  const { wallet, nonce, signature } = body.parse(await readJson(req));
  // Consume the nonce atomically: only an unused, unexpired challenge for this wallet qualifies.
  const rows = must(
    await db()
      .from("auth_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("nonce", nonce)
      .eq("wallet", wallet)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("message"),
  ) as { message: string }[];
  if (rows.length !== 1) throw new HttpError(401, "Sign-in request expired or already used. Try again.");
  if (!verifyDetachedSignature(rows[0].message, signature, wallet)) throw new HttpError(401, "Signature does not match this wallet");
  must(await db().from("wallets").upsert({ address: wallet, last_seen_at: new Date().toISOString() }));
  await createSession(wallet);
  await audit("auth.sign_in", wallet, wallet);
  return json({ wallet });
});
