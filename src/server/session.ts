import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { CLUSTER } from "@/lib/config";
import { requireEnv } from "./env";
import { HttpError } from "./http";

const COOKIE = "pfotc_session";
const TTL_SECONDS = 60 * 60 * 24; // 24h

function key() {
  return new TextEncoder().encode(requireEnv("SESSION_SECRET").SESSION_SECRET);
}

export async function createSession(wallet: string) {
  const token = await new SignJWT({ wallet, network: CLUSTER })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** The authenticated wallet, or null. A wallet address in a request body is never identity. */
export async function currentWallet(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.network !== CLUSTER || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function requireWallet(): Promise<string> {
  const w = await currentWallet();
  if (!w) throw new HttpError(401, "Sign in with your wallet first");
  return w;
}
