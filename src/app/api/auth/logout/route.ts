import { handle, json } from "@/server/http";
import { clearSession } from "@/server/session";

export const POST = handle(async () => {
  await clearSession();
  return json({ ok: true });
});
