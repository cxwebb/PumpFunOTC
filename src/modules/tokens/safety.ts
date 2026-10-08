/**
 * Token safety gate for OTC settlement. Only plain SPL tokens and Token-2022
 * mints without risky extensions can be traded.
 */
import { type Connection, PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  unpackMint,
} from "@solana/spl-token";

const ALLOWED_2022_EXTENSIONS = new Set<ExtensionType>([
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
  ExtensionType.GroupPointer,
  ExtensionType.GroupMemberPointer,
  ExtensionType.TokenGroup,
  ExtensionType.TokenGroupMember,
  ExtensionType.MintCloseAuthority,
]);

export interface MintSafety {
  ok: boolean;
  reasons: string[];
  tokenProgram: string;
  decimals: number;
  supply: bigint;
  extensions: string[];
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export async function checkMintSafety(connection: Connection, mintAddress: string): Promise<MintSafety> {
  const mint = new PublicKey(mintAddress);
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Mint account not found on this network");
  const owner = info.owner;
  if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Account is not an SPL token mint");
  const parsed = unpackMint(mint, info, owner);
  const reasons: string[] = [];
  const extensions = owner.equals(TOKEN_2022_PROGRAM_ID) ? getExtensionTypes(parsed.tlvData) : [];
  for (const ext of extensions) {
    if (!ALLOWED_2022_EXTENSIONS.has(ext)) reasons.push(`Unsupported Token-2022 extension: ${ExtensionType[ext] ?? ext}`);
  }
  if (parsed.freezeAuthority) reasons.push("Mint has a freeze authority");
  if (!parsed.isInitialized) reasons.push("Mint is not initialized");
  return {
    ok: reasons.length === 0,
    reasons,
    tokenProgram: owner.toBase58(),
    decimals: parsed.decimals,
    supply: parsed.supply,
    extensions: extensions.map((e) => ExtensionType[e] ?? String(e)),
    mintAuthority: parsed.mintAuthority?.toBase58() ?? null,
    freezeAuthority: parsed.freezeAuthority?.toBase58() ?? null,
  };
}
