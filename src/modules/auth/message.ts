/** Sign-In With Solana style message. Built on the server, shown and signed in the wallet. */
export function signInMessage(p: { domain: string; address: string; network: string; nonce: string; issuedAt: string; expiresAt: string }): string {
  return [
    `${p.domain} wants you to sign in with your Solana account:`,
    p.address,
    "",
    "Sign in to PumpFunOTC. This does not send a transaction or cost any fees.",
    "",
    `URI: ${p.domain.startsWith("localhost") ? "http" : "https"}://${p.domain}`,
    "Version: 1",
    `Network: ${p.network}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expiresAt}`,
  ].join("\n");
}
