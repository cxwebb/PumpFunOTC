import { Keypair, PublicKey, VersionedMessage, VersionedTransaction, type VersionedTransactionResponse } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { beforeEach, describe, expect, it } from "vitest";
import type { LiteSVM } from "litesvm";
import { orderHash } from "@/modules/otc/orders/order";
import {
  assembleSignedTransaction,
  buildSettlementMessageBytes,
  deriveSettlementTerms,
  extractWalletSignature,
  reconcileSettlement,
  type SettlementBuildParams,
  verifyMessageSignature,
  verifySettlementMessage,
} from "@/modules/otc/settlement";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TREASURY, makeOrder, signBytes } from "./helpers";
import { airdrop, balance, createMint, isFailure, mintTo, newSvm, send, tokenBalance } from "./svm";

const OPTS = { maxComputeUnitPriceMicroLamports: 200_000, expectedTreasury: TREASURY.publicKey.toBase58(), maxFeeBps: 50 };

for (const [label, programId] of [
  ["SPL Token", TOKEN_PROGRAM_ID],
  ["Token-2022", TOKEN_2022_PROGRAM_ID],
] as const) {
  describe(`atomic settlement (${label})`, () => {
    let svm: LiteSVM;
    let seller: Keypair;
    let buyer: Keypair;
    let mintAuthority: Keypair;
    let mint: string;

    beforeEach(() => {
      svm = newSvm();
      seller = Keypair.generate();
      buyer = Keypair.generate();
      mintAuthority = Keypair.generate();
      airdrop(svm, seller.publicKey, 1);
      airdrop(svm, buyer.publicKey, 10);
      airdrop(svm, mintAuthority.publicKey, 1);
      airdrop(svm, TREASURY.publicKey, 1);
      const m = createMint(svm, mintAuthority, 6, programId);
      mintTo(svm, mintAuthority, m, seller.publicKey, 5_000_000_000n, programId);
      mint = m.toBase58();
    });

    function setup(overrides: Record<string, unknown> = {}) {
      const order = makeOrder({ maker: seller.publicKey.toBase58(), mint, tokenProgram: programId.toBase58(), ...overrides });
      const terms = deriveSettlementTerms(order, buyer.publicKey.toBase58());
      const params: SettlementBuildParams = {
        terms,
        orderHash: orderHash(order),
        settlementId: "11111111-2222-4333-8444-555555555555",
        recentBlockhash: svm.latestBlockhash(),
        computeUnitLimit: 80_000,
        computeUnitPriceMicroLamports: 1_000,
      };
      return { order, terms, params, bytes: buildSettlementMessageBytes(params) };
    }

    it("both wallets sign the identical message; tokens and SOL move atomically; receipt reconciles", () => {
      const { terms, params, bytes } = setup();
      expect(verifySettlementMessage(bytes, params, OPTS)).toEqual({ ok: true, errors: [] });

      const buyerSig = signBytes(bytes, buyer);
      const sellerSig = signBytes(bytes, seller);
      expect(verifyMessageSignature(bytes, terms.buyer, buyerSig)).toBe(true);
      expect(verifyMessageSignature(bytes, terms.seller, buyerSig)).toBe(false);

      const tx = assembleSignedTransaction(bytes, [
        { signer: terms.buyer, signature: buyerSig },
        { signer: terms.seller, signature: sellerSig },
      ]);
      const sAta = getAssociatedTokenAddressSync(new PublicKey(mint), seller.publicKey, false, programId);
      const bAta = getAssociatedTokenAddressSync(new PublicKey(mint), buyer.publicKey, false, programId);

      const pre = {
        seller: balance(svm, seller.publicKey),
        buyer: balance(svm, buyer.publicKey),
        treasury: balance(svm, TREASURY.publicKey),
        sTok: tokenBalance(svm, sAta),
        bTok: tokenBalance(svm, bAta),
      };
      const res = send(svm, tx);
      expect(isFailure(res), isFailure(res) ? res.meta().logs().join("\n") : "").toBe(false);
      const post = {
        seller: balance(svm, seller.publicKey),
        buyer: balance(svm, buyer.publicKey),
        treasury: balance(svm, TREASURY.publicKey),
        sTok: tokenBalance(svm, sAta),
        bTok: tokenBalance(svm, bAta),
      };

      expect(terms.feeLamports).toBe(10_000_000n);
      expect(post.seller - pre.seller).toBe(terms.sellerNetLamports);
      expect(post.treasury - pre.treasury).toBe(terms.feeLamports);
      expect(pre.sTok - post.sTok).toBe(terms.tokenAmount);
      expect(post.bTok - pre.bTok).toBe(terms.tokenAmount);
      // buyer pays gross + ATA rent + network fee
      expect(pre.buyer - post.buyer > terms.grossLamports).toBe(true);

      // Reconcile against an RPC-shaped response built from observed balances.
      const message = VersionedMessage.deserialize(bytes);
      const keys = message.staticAccountKeys.map((k) => k.toBase58());
      const bal = (k: string, which: "pre" | "post") => {
        const map: Record<string, keyof typeof pre> = { [terms.seller]: "seller", [terms.buyer]: "buyer", [terms.treasury]: "treasury" };
        const field = map[k];
        return field ? Number((which === "pre" ? pre : post)[field]) : 0;
      };
      const tb = (which: "pre" | "post") => [
        { accountIndex: keys.indexOf(sAta.toBase58()), mint, owner: terms.seller, uiTokenAmount: { amount: String((which === "pre" ? pre : post).sTok), decimals: 6, uiAmount: null } },
        { accountIndex: keys.indexOf(bAta.toBase58()), mint, owner: terms.buyer, uiTokenAmount: { amount: String((which === "pre" ? pre : post).bTok), decimals: 6, uiAmount: null } },
      ];
      const response = {
        slot: 1,
        blockTime: 1,
        transaction: { message, signatures: [] },
        meta: {
          err: null,
          fee: 5000,
          preBalances: keys.map((k) => bal(k, "pre")),
          postBalances: keys.map((k) => bal(k, "post")),
          preTokenBalances: tb("pre"),
          postTokenBalances: tb("post"),
        },
      } as unknown as VersionedTransactionResponse;
      expect(reconcileSettlement(response, bytes, terms).ok).toBe(true);
      // A different message must not reconcile.
      const other = setup({ lamports: "2000000001" });
      expect(reconcileSettlement(response, other.bytes, other.terms).ok).toBe(false);
    });

    it("rejects any modified transaction before signing", () => {
      const { params, bytes } = setup();
      // Attacker swaps the amount sent to the seller.
      const tampered = buildSettlementMessageBytes({ ...params, terms: { ...params.terms, sellerNetLamports: 1n } });
      const r = verifySettlementMessage(tampered, params, OPTS);
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("Transaction bytes differ from the canonical rebuild of the signed order");
      expect(r.errors).toContain("SOL to seller does not equal price minus fee");

      // Fee redirected to another address.
      const thief = Keypair.generate().publicKey.toBase58();
      const redirected = buildSettlementMessageBytes({ ...params, terms: { ...params.terms, treasury: thief } });
      expect(verifySettlementMessage(redirected, params, OPTS).ok).toBe(false);
      // Verifier refuses terms whose treasury is not the published one.
      expect(verifySettlementMessage(redirected, { ...params, terms: { ...params.terms, treasury: thief } }, OPTS).ok).toBe(false);

      // Single flipped byte.
      const flipped = new Uint8Array(bytes);
      flipped[flipped.length - 1] ^= 1;
      expect(verifySettlementMessage(flipped, params, OPTS).ok).toBe(false);
      // Fee above signed maximum.
      expect(verifySettlementMessage(bytes, params, { ...OPTS, maxFeeBps: 10 }).ok).toBe(false);
    });

    it("detects a wallet that alters the message while signing", () => {
      const { params, bytes } = setup();
      const altered = buildSettlementMessageBytes({ ...params, computeUnitPriceMicroLamports: 999 });
      const tx = new VersionedTransaction(VersionedMessage.deserialize(altered));
      tx.sign([buyer]);
      expect(() => extractWalletSignature(tx, bytes, params.terms.buyer)).toThrow(/changed the transaction/);
      const good = new VersionedTransaction(VersionedMessage.deserialize(bytes));
      good.sign([buyer]);
      expect(extractWalletSignature(good, bytes, params.terms.buyer)).toBe(signBytes(bytes, buyer));
    });

    it("cannot broadcast with only one signature", () => {
      const { terms, bytes } = setup();
      expect(() => assembleSignedTransaction(bytes, [{ signer: terms.buyer, signature: signBytes(bytes, buyer) }])).toThrow();
      expect(() =>
        assembleSignedTransaction(bytes, [
          { signer: terms.buyer, signature: signBytes(bytes, buyer) },
          { signer: terms.seller, signature: signBytes(bytes, buyer) },
        ]),
      ).toThrow(/Invalid signature/);
    });

    it("fails atomically when the seller lacks tokens: no SOL moves", () => {
      const { terms, bytes } = setup({ tokenAmount: "999000000000" });
      const tx = assembleSignedTransaction(bytes, [
        { signer: terms.buyer, signature: signBytes(bytes, buyer) },
        { signer: terms.seller, signature: signBytes(bytes, seller) },
      ]);
      const sellerBefore = balance(svm, seller.publicKey);
      const treasuryBefore = balance(svm, TREASURY.publicKey);
      const res = send(svm, tx);
      expect(isFailure(res)).toBe(true);
      expect(balance(svm, seller.publicKey)).toBe(sellerBefore);
      expect(balance(svm, TREASURY.publicKey)).toBe(treasuryBefore);
    });

    it("fails atomically when the buyer lacks SOL", () => {
      const { terms, bytes } = setup({ lamports: "50000000000" });
      const tx = assembleSignedTransaction(bytes, [
        { signer: terms.buyer, signature: signBytes(bytes, buyer) },
        { signer: terms.seller, signature: signBytes(bytes, seller) },
      ]);
      const sAta = getAssociatedTokenAddressSync(new PublicKey(mint), seller.publicKey, false, programId);
      const before = tokenBalance(svm, sAta);
      expect(isFailure(send(svm, tx))).toBe(true);
      expect(tokenBalance(svm, sAta)).toBe(before);
    });

    it("rejects a transaction with an expired blockhash", () => {
      const { terms, bytes } = setup();
      svm.expireBlockhash();
      const tx = assembleSignedTransaction(bytes, [
        { signer: terms.buyer, signature: signBytes(bytes, buyer) },
        { signer: terms.seller, signature: signBytes(bytes, seller) },
      ]);
      expect(isFailure(send(svm, tx))).toBe(true);
    });

    it("cannot be replayed", () => {
      const { terms, bytes } = setup();
      const tx = assembleSignedTransaction(bytes, [
        { signer: terms.buyer, signature: signBytes(bytes, buyer) },
        { signer: terms.seller, signature: signBytes(bytes, seller) },
      ]);
      expect(isFailure(send(svm, tx))).toBe(false);
      expect(isFailure(send(svm, tx))).toBe(true);
    });
  });
}

describe("terms", () => {
  it("refuses maker-as-taker and wrong private counterparty", () => {
    const maker = Keypair.generate().publicKey.toBase58();
    const order = makeOrder({ maker, mint: Keypair.generate().publicKey.toBase58(), counterparty: Keypair.generate().publicKey.toBase58() });
    expect(() => deriveSettlementTerms(order, maker)).toThrow();
    expect(() => deriveSettlementTerms(order, Keypair.generate().publicKey.toBase58())).toThrow(/private/);
  });
  it("bid side makes the maker the buyer", () => {
    const maker = Keypair.generate().publicKey.toBase58();
    const taker = Keypair.generate().publicKey.toBase58();
    const t = deriveSettlementTerms(makeOrder({ maker, mint: Keypair.generate().publicKey.toBase58(), side: "buy" }), taker);
    expect(t.buyer).toBe(maker);
    expect(t.seller).toBe(taker);
  });
});
