import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NotConfiguredError } from "./env";
import { DbError } from "./supabase";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Serialize bigint values as decimal strings. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function handle<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, details: e.details }, e.status);
      if (e instanceof ZodError) return json({ error: "Invalid request", details: e.issues }, 400);
      if (e instanceof NotConfiguredError) return json({ error: e.message, missing: e.variables }, 503);
      if (e instanceof DbError && e.code === "P0001") return json({ error: e.message }, 409);
      if (e instanceof DbError && e.code === "23505") return json({ error: "Already exists or conflicts with an active record" }, 409);
      const msg = (e as Error)?.message ?? "";
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|429 Too Many Requests/i.test(msg)) {
        return json({ error: "An upstream service (Solana RPC or market data) is unreachable right now. Try again shortly." }, 502);
      }
      console.error(e);
      return json({ error: "Internal error" }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}
