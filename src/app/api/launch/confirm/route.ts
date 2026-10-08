import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { pubkeySchema } from "@/lib/validation";
import { HttpError, handle, json, readJson } from "@/server/http";
import { rpc } from "@/server/solana";
import { requireWallet } from "@/server/session";
import { db, must } from "@/server/supabase";

const body = z.object({ mint: pubkeySchema, signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) });

/** Mark a launch confirmed only after the chain shows the transaction and the curve. */
export const POST = handle(async (req) => {
  const user = await requireWallet();
  const { mint, signature } = body.parse(await readJson(req));
  const conn = rpc();
  const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) throw new HttpError(404, "Transaction not found yet; try again in a few seconds");
  if (tx.meta?.err) {
    must(await db().from("launches").update({ status: "failed", tx_signature: signature }).eq("mint", mint).eq("creator", user));
    throw new HttpError(409, "Launch transaction failed on chain");
  }
  const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== user || !keys.includes(mint)) throw new HttpError(400, "Transaction does not match this launch");
  const curve = await conn.getAccountInfo(bondingCurvePda(new PublicKey(mint)), "confirmed");
  if (!curve) throw new HttpError(409, "Bonding curve not found for this mint");
  must(
    await db()
      .from("launches")
      .update({ status: "confirmed", tx_signature: signature, confirmed_at: new Date().toISOString() })
      .eq("mint", mint)
      .eq("creator", user),
  );
  return json({ ok: true });
});
