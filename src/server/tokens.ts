import "server-only";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata } from "@solana/spl-token";
import { checkMintSafety, type MintSafety } from "@/modules/tokens/safety";
import { detectVenue, type VenueInfo } from "./pump";
import { rpc } from "./solana";

export interface ChainTokenInfo {
  mint: string;
  found: boolean;
  safety: (Omit<MintSafety, "supply"> & { supply: string }) | null;
  metadata: { name: string; symbol: string; uri: string } | null;
  venue: VenueInfo | null;
  error?: string;
}

/** Token facts from the app's own cluster (devnet by default). */
export async function chainTokenInfo(mint: string): Promise<ChainTokenInfo> {
  try {
    const safety = await checkMintSafety(rpc(), mint);
    let metadata: ChainTokenInfo["metadata"] = null;
    if (safety.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58()) {
      const md = await getTokenMetadata(rpc(), new PublicKey(mint), "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
      if (md) metadata = { name: md.name, symbol: md.symbol, uri: md.uri };
    }
    const venue = await detectVenue(mint).catch(() => null);
    return { mint, found: true, safety: { ...safety, supply: safety.supply.toString() }, metadata, venue };
  } catch (e) {
    return { mint, found: false, safety: null, metadata: null, venue: null, error: (e as Error).message };
  }
}
