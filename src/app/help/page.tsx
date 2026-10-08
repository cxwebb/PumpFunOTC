import Link from "next/link";
import { OTC_FEE_BPS } from "@/lib/config";

export const metadata = { title: "Help" };

const sections: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "otc",
    title: "How OTC trading works",
    body: (
      <ol className="list-decimal ml-5 space-y-2">
        <li>
          <b>Post a signed offer.</b> You sign an ask (sell) or bid (buy) as a free message. It is not a transaction and your assets stay in your wallet.
        </li>
        <li>
          <b>Negotiate.</b> Anyone (or only the wallet you named, for a private offer) can accept or counter. Each counter is a new signed order bound to the previous one&apos;s hash;
          earlier orders are never edited, and only the newest revision can be accepted.
        </li>
        <li>
          <b>Both sign one transaction.</b> When an offer is accepted, the server re-checks both balances and builds one Solana transaction. Each browser rebuilds it from the signed
          order and compares every byte before your wallet is asked to sign. The buyer signs first and pays the network fee; the seller signs second.
        </li>
        <li>
          <b>Settlement and receipt.</b> The transaction moves the tokens to the buyer, the SOL to the seller, and the disclosed fee to the treasury, all at once. A trade is only
          marked filled after the finalized transaction is read back from the chain and every amount matches.
        </li>
      </ol>
    ),
  },
  {
    id: "escrowless",
    title: "Escrowless means not guaranteed to fill",
    body: (
      <p>
        Nothing is locked when you post an offer. A trade needs the maker online to sign within about a minute of a taker accepting, and both wallets must still hold the assets. If
        either side does not sign in time, the transaction expires, nothing moves, and the offer reopens if it has not expired.
      </p>
    ),
  },
  {
    id: "cancel",
    title: "Cancelling and expiry",
    body: (
      <p>
        Cancelling is a signed message. After it, this app will not collect signatures for or submit that offer. A settlement transaction you already signed stays valid on Solana
        until its blockhash expires (typically 60–90 seconds); the app cannot recall it. Offers also expire at the time you chose.
      </p>
    ),
  },
  {
    id: "tokens",
    title: "Supported tokens",
    body: (
      <p>
        SPL tokens and Token-2022 tokens without risky extensions. Tokens with transfer hooks, transfer fees, permanent delegates, default-frozen accounts, non-transferable flags,
        confidential transfers or a freeze authority are refused. Spot trading supports SOL-quoted Pump.fun bonding curves and PumpSwap pools, detected from on-chain state.
      </p>
    ),
  },
  {
    id: "safety",
    title: "Safety",
    body: (
      <ul className="list-disc ml-5 space-y-1">
        <li>This app never asks for your seed phrase or private key. Every transaction is signed in your own wallet.</li>
        <li>The app defaults to Solana devnet. Mainnet requires an explicit configuration switch.</li>
        <li>This software has not been independently audited. Do not trade amounts you cannot afford to lose.</li>
        <li>Market data (prices, market caps, charts) comes from DexScreener and GeckoTerminal on Solana mainnet and may be delayed. Missing values are shown as unavailable.</li>
      </ul>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-bold">Help</h1>
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="panel p-5 space-y-2 leading-relaxed">
          <h2 className="font-bold text-up">{s.title}</h2>
          <div className="text-ink/90">{s.body}</div>
        </section>
      ))}
      <p className="text-dim text-xs">
        OTC fee: {OTC_FEE_BPS / 100}% of the price, from seller proceeds. See <Link href="/fees" className="text-info">fees</Link>.
      </p>
    </div>
  );
}
