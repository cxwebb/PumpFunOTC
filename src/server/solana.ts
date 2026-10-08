import "server-only";
import { Connection } from "@solana/web3.js";
import { PUBLIC_RPC_URL } from "@/lib/config";
import { serverEnv } from "./env";

let connection: Connection | null = null;

/** Server RPC connection (may use a private Helius URL with an API key). */
export function rpc(): Connection {
  if (!connection) connection = new Connection(serverEnv.SOLANA_RPC_URL || PUBLIC_RPC_URL, { commitment: "confirmed" });
  return connection;
}
