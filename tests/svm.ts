/**
 * Thin bridge between @solana/web3.js v1 objects and LiteSVM (which speaks
 * @solana/kit types). LiteSVM executes the real System, SPL Token,
 * Token-2022, ATA and Memo programs in-process.
 */
import { address, getTransactionDecoder, lamports as kitLamports } from "@solana/kit";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  type ExtensionType,
} from "@solana/spl-token";

export function newSvm(): LiteSVM {
  return new LiteSVM();
}

export function send(svm: LiteSVM, tx: VersionedTransaction) {
  const kitTx = getTransactionDecoder().decode(tx.serialize());
  return svm.sendTransaction(kitTx);
}

export function isFailure(result: unknown): result is FailedTransactionMetadata {
  return result instanceof FailedTransactionMetadata;
}

export function sendIxs(svm: LiteSVM, payer: Keypair, ixs: TransactionInstruction[], extraSigners: Keypair[] = []) {
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...extraSigners]);
  const res = send(svm, tx);
  if (isFailure(res)) throw new Error(`setup tx failed: ${res.err()} ${res.meta().logs().join("\n")}`);
  return res;
}

export function airdrop(svm: LiteSVM, to: PublicKey, sol: number) {
  svm.airdrop(address(to.toBase58()), kitLamports(BigInt(sol) * 1_000_000_000n));
}

export function balance(svm: LiteSVM, who: PublicKey): bigint {
  return svm.getBalance(address(who.toBase58())) ?? 0n;
}

export function tokenBalance(svm: LiteSVM, ata: PublicKey): bigint {
  const acc = svm.getAccount(address(ata.toBase58()));
  if (!acc.exists) return 0n;
  return AccountLayout.decode(Buffer.from(acc.data.slice(0, AccountLayout.span))).amount;
}

export function createMint(svm: LiteSVM, payer: Keypair, decimals: number, tokenProgram: PublicKey, extensions: ExtensionType[] = []) {
  const mint = Keypair.generate();
  const space = getMintLen(extensions);
  const rent = svm.minimumBalanceForRentExemption(BigInt(space));
  sendIxs(
    svm,
    payer,
    [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: Number(rent), space, programId: tokenProgram }),
      createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null, tokenProgram),
    ],
    [mint],
  );
  return mint.publicKey;
}

export function mintTo(svm: LiteSVM, payer: Keypair, mint: PublicKey, owner: PublicKey, amount: bigint, tokenProgram: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  sendIxs(svm, payer, [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint, tokenProgram),
    createMintToInstruction(mint, ata, payer.publicKey, amount, [], tokenProgram),
  ]);
  return ata;
}
