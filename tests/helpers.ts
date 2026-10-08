import { Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import nacl from "tweetnacl";
import { base58, randomHex } from "@/lib/encoding";
import { type Order, orderSigningMessage } from "@/modules/otc/orders/order";

export const TREASURY = Keypair.generate();

export function makeOrder(overrides: Partial<Order> & { maker: string; mint: string }): Order {
  return {
    version: 1,
    domain: "localhost:3000",
    network: "devnet",
    side: "sell",
    counterparty: null,
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 6,
    tokenAmount: "1000000000",
    lamports: "2000000000",
    feeBps: 50,
    treasury: TREASURY.publicKey.toBase58(),
    partialFill: "none",
    parentHash: null,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    nonce: randomHex(16),
    ...overrides,
  };
}

export function signText(text: string, kp: Keypair): string {
  return base58.encode(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));
}

export function signOrder(order: Order, kp: Keypair): string {
  return signText(orderSigningMessage(order), kp);
}

export function signBytes(bytes: Uint8Array, kp: Keypair): string {
  return base58.encode(nacl.sign.detached(bytes, kp.secretKey));
}

export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };
