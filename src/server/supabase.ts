import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let client: SupabaseClient | null = null;

/** Service-role client. Server only; never expose to the browser. */
export function db(): SupabaseClient {
  if (client) return client;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Unwrap a Supabase response or throw. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new DbError(res.error.message, res.error.code);
  return res.data as T;
}

export class DbError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
  }
}

export async function audit(event: string, actor: string | null, subject: string | null, data: Record<string, unknown> = {}) {
  try {
    await db().from("audit_events").insert({ event, actor, subject, data });
  } catch {
    // Audit must never break the main flow.
  }
}
