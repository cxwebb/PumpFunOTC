import { z } from "zod";
import { APP_DOMAIN, CLUSTER } from "@/lib/config";
import { randomHex } from "@/lib/encoding";
import { pubkeySchema } from "@/lib/validation";
import { signInMessage } from "@/modules/auth/message";
import { handle, json, readJson } from "@/server/http";
import { db, must } from "@/server/supabase";

const body = z.object({ wallet: pubkeySchema });

export const POST = handle(async (req) => {
  const { wallet } = body.parse(await readJson(req));
  const nonce = randomHex(16);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
  const message = signInMessage({
    domain: APP_DOMAIN,
    address: wallet,
    network: CLUSTER,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  must(await db().from("auth_challenges").insert({ nonce, wallet, message, expires_at: expiresAt.toISOString() }));
  return json({ nonce, message });
});
