import { handle, json } from "@/server/http";
import { currentWallet } from "@/server/session";

export const GET = handle(async () => json({ wallet: await currentWallet() }));
