/** Normalized market snapshot for a token. Missing values stay null; nothing is estimated. */
export interface MarketToken {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  priceSol: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  /** "pumpfun" = bonding curve, "pumpswap" = graduated, other = another DEX. */
  venue: string | null;
  pairAddress: string | null;
  pairCreatedAt: number | null;
  source: "dexscreener";
  /** Market data comes from Solana mainnet regardless of the app's cluster. */
  network: "mainnet-beta";
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
