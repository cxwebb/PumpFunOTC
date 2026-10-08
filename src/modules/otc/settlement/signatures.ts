import { PublicKey, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { base58 } from "@/lib/encoding";

/** Verify an Ed25519 signature over the exact stored message bytes. */
export function verifyMessageSignature(messageBytes: Uint8Array, signer: string, signatureB58: string): boolean {
  try {
    const sig = base58.decode(signatureB58);
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(messageBytes, sig, new PublicKey(signer).toBytes());
  } catch {
    return false;
  }
}

/**
 * Extract the signature a wallet produced for `signer` from a signed
 * transaction, and confirm the wallet did not alter the message.
 */
export function extractWalletSignature(signedTx: VersionedTransaction, expectedMessage: Uint8Array, signer: string): string {
  const signedMessage = signedTx.message.serialize();
  if (signedMessage.length !== expectedMessage.length || !signedMessage.every((b, i) => b === expectedMessage[i])) {
    throw new Error("Your wallet changed the transaction before signing. Signing was stopped; nothing was sent.");
  }
  const index = signedTx.message.staticAccountKeys.findIndex((k) => k.toBase58() === signer);
  if (index < 0 || index >= signedTx.message.header.numRequiredSignatures) throw new Error("Wallet is not a required signer");
  const sig = signedTx.signatures[index];
  if (!sig || sig.every((b) => b === 0)) throw new Error("Wallet did not sign");
  const b58 = base58.encode(sig);
  if (!verifyMessageSignature(expectedMessage, signer, b58)) throw new Error("Wallet signature is invalid");
  return b58;
}

/** Assemble the final transaction from stored bytes and both verified signatures. */
export function assembleSignedTransaction(messageBytes: Uint8Array, signatures: { signer: string; signature: string }[]): VersionedTransaction {
  const message = VersionedMessage.deserialize(messageBytes);
  const tx = new VersionedTransaction(message);
  for (const { signer, signature } of signatures) {
    if (!verifyMessageSignature(messageBytes, signer, signature)) throw new Error(`Invalid signature for ${signer}`);
    tx.addSignature(new PublicKey(signer), base58.decode(signature));
  }
  const required = message.header.numRequiredSignatures;
  for (let i = 0; i < required; i++) {
    if (tx.signatures[i].every((b) => b === 0)) throw new Error("Missing a required signature");
  }
  return tx;
}
