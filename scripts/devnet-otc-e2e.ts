/**
 * Live devnet end-to-end test of the OTC settlement protocol.
 *
 * Uses two independent throwaway devnet wallets (seller and buyer) plus a
 * treasury, mints a fresh test token, and settles one token-for-SOL trade with
 * the exact builder, verifier and reconciler the app uses. Both wallets sign
 * the identical message bytes. The trade is confirmed at "finalized" and then
 * reconciled from the chain.
 *
 * Keypairs are generated into ./.devnet/ (gitignored). They are devnet-only
 * test wallets: never put real funds in them.
 *
 * Usage:  npm run devnet:otc-e2e
 * Env:    SOLANA_RPC_URL (optional, defaults to https://api.devnet.solana.com)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { base58, randomHex } from "../src/lib/encoding";
import { formatSol } from "../src/lib/amounts";
import { type Order, orderHash, orderSigningMessage, verifyOrderSignature } from "../src/modules/otc/orders/order";
import {
  assembleSignedTransaction,
  buildSettlementMessageBytes,
  deriveSettlementTerms,
  reconcileSettlement,
  verifySettlementMessage,
} from "../src/modules/otc/settlement";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const DIR = join(process.cwd(), ".devnet");

function loadOrCreate(name: string): Keypair {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${name}.keypair.json`);
  if (existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  const kp = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

async function ensureSol(conn: Connection, kp: Keypair, name: string, minSol: number) {
  const bal = await conn.getBalance(kp.publicKey);
  if (bal >= minSol * LAMPORTS_PER_SOL) return;
  console.log(`Requesting devnet airdrop for ${name} ${kp.publicKey.toBase58()} …`);
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    throw new Error(
      `Airdrop failed (${(e as Error).message}). Fund ${kp.publicKey.toBase58()} with at least ${minSol} devnet SOL at https://faucet.solana.com and re-run.`,
    );
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const seller = loadOrCreate("seller");
  const buyer = loadOrCreate("buyer");
  const treasury = loadOrCreate("treasury");
  console.log("RPC      ", RPC);
  console.log("seller   ", seller.publicKey.toBase58());
  console.log("buyer    ", buyer.publicKey.toBase58());
  console.log("treasury ", treasury.publicKey.toBase58());

  await ensureSol(conn, seller, "seller", 0.2);
  await ensureSol(conn, buyer, "buyer", 0.5);
  // The treasury must be rent-exempt to receive a small fee.
  if ((await conn.getBalance(treasury.publicKey)) === 0) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: treasury.publicKey, lamports: 1_000_000 })),
      [buyer],
    );
  }

  console.log("Creating a fresh test mint (6 decimals) and minting 1,000 tokens to the seller …");
  const mint = await createMint(conn, seller, seller.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);
  const sellerAta = await createAssociatedTokenAccountIdempotent(conn, seller, mint, seller.publicKey);
  await mintTo(conn, seller, mint, sellerAta, seller, 1_000_000_000n);

  // 1. Seller signs an OTC ask: 250 tokens for 0.1 SOL.
  const order: Order = {
    version: 1,
    domain: process.env.NEXT_PUBLIC_APP_DOMAIN || "localhost:3000",
    network: "devnet",
    side: "sell",
    maker: seller.publicKey.toBase58(),
    counterparty: null,
    mint: mint.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 6,
    tokenAmount: "250000000",
    lamports: "100000000",
    feeBps: 50,
    treasury: treasury.publicKey.toBase58(),
    partialFill: "none",
    parentHash: null,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    nonce: randomHex(16),
  };
  const orderSig = base58.encode(nacl.sign.detached(new TextEncoder().encode(orderSigningMessage(order)), seller.secretKey));
  if (!verifyOrderSignature(order, orderSig)) throw new Error("order signature check failed");
  const hash = orderHash(order);
  console.log("Order hash", hash);

  // 2. Build the settlement exactly as the server does.
  const terms = deriveSettlementTerms(order, buyer.publicKey.toBase58());
  const latest = await conn.getLatestBlockhash("confirmed");
  const params = {
    terms,
    orderHash: hash,
    settlementId: crypto.randomUUID(),
    recentBlockhash: latest.blockhash,
    computeUnitLimit: 80_000,
    computeUnitPriceMicroLamports: 10_000,
  };
  const bytes = buildSettlementMessageBytes(params);

  // 3. Each party independently verifies, then signs the identical bytes.
  const opts = { maxComputeUnitPriceMicroLamports: 200_000, expectedTreasury: treasury.publicKey.toBase58(), maxFeeBps: 50 };
  for (const who of ["buyer", "seller"]) {
    const r = verifySettlementMessage(bytes, params, opts);
    if (!r.ok) throw new Error(`${who} verification failed: ${r.errors.join("; ")}`);
  }
  const buyerSig = base58.encode(nacl.sign.detached(bytes, buyer.secretKey));
  const sellerSig = base58.encode(nacl.sign.detached(bytes, seller.secretKey));
  const tx = assembleSignedTransaction(bytes, [
    { signer: terms.buyer, signature: buyerSig },
    { signer: terms.seller, signature: sellerSig },
  ]);

  const buyerAta = getAssociatedTokenAddressSync(mint, buyer.publicKey);
  const before = {
    seller: await conn.getBalance(seller.publicKey),
    treasury: await conn.getBalance(treasury.publicKey),
  };

  // 4. Simulate, send, wait for finalized.
  const sim = await conn.simulateTransaction(tx, { sigVerify: true });
  if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${sim.value.logs?.join("\n")}`);
  const sig = await conn.sendRawTransaction(tx.serialize());
  console.log("Submitted", sig);
  await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "finalized");

  // 5. Reconcile from the chain.
  const landed = await conn.getTransaction(sig, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!landed) throw new Error("finalized transaction not found");
  const rec = reconcileSettlement(landed, bytes, terms);
  const buyerTokens = (await getAccount(conn, buyerAta, "finalized")).amount;
  console.log({
    reconciled: rec.ok,
    errors: rec.errors,
    buyerTokens: buyerTokens.toString(),
    sellerSolDelta: formatSol(BigInt((await conn.getBalance(seller.publicKey, "finalized")) - before.seller)),
    treasuryFee: formatSol(BigInt((await conn.getBalance(treasury.publicKey, "finalized")) - before.treasury)),
    explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
  });
  if (!rec.ok) process.exit(1);
  console.log("PASS: atomic devnet settlement verified on chain.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});

