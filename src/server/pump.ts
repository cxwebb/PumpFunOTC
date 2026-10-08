import "server-only";
import BN from "bn.js";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
} from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput, canonicalPumpPoolPda, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import { toBase64 } from "@/lib/encoding";
import { HttpError } from "./http";
import { rpc } from "./solana";

export type Venue = "curve" | "pumpswap" | "none";

const DEFAULT_PUBKEY = PublicKey.default.toBase58();
const CU_LIMIT = 400_000;
const CU_PRICE = 50_000;

function isSolQuote(q: PublicKey | undefined | null) {
  return !q || q.equals(NATIVE_MINT) || q.toBase58() === DEFAULT_PUBKEY;
}

async function mintProgram(mint: PublicKey): Promise<PublicKey> {
  const info = await rpc().getAccountInfo(mint, "confirmed");
  if (!info) throw new HttpError(404, "Mint not found on this network");
  if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) return info.owner;
  throw new HttpError(400, "Not a token mint");
}

export interface VenueInfo {
  venue: Venue;
  tokenProgram: string | null;
  complete: boolean | null;
  creator: string | null;
  pool: string | null;
  /** Bonding-curve progress toward graduation, 0..1, from real token reserves. */
  progress: number | null;
}

/** Detect where a token trades, purely from on-chain state. */
export async function detectVenue(mintStr: string): Promise<VenueInfo> {
  const mint = new PublicKey(mintStr);
  const conn = rpc();
  const tokenProgram = await mintProgram(mint).catch(() => null);
  const curveInfo = await conn.getAccountInfo(bondingCurvePda(mint), "confirmed");
  if (curveInfo) {
    const curve = await new OnlinePumpSdk(conn).fetchBondingCurve(mint);
    if (!isSolQuote(curve.quoteMint)) return { venue: "none", tokenProgram: tokenProgram?.toBase58() ?? null, complete: curve.complete, creator: curve.creator.toBase58(), pool: null, progress: null };
    if (!curve.complete) {
      // Pump curves start with ~793.1M real tokens for sale; progress = sold / initial.
      const global = await new OnlinePumpSdk(conn).fetchGlobal();
      const initial = global.initialRealTokenReserves;
      const sold = initial.sub(curve.realTokenReserves);
      const progress = initial.isZero() ? null : Math.min(1, Math.max(0, sold.mul(new BN(10_000)).div(initial).toNumber() / 10_000));
      return { venue: "curve", tokenProgram: tokenProgram?.toBase58() ?? null, complete: false, creator: curve.creator.toBase58(), pool: null, progress };
    }
  }
  const pool = canonicalPumpPoolPda(mint);
  const poolInfo = await conn.getAccountInfo(pool, "confirmed");
  if (poolInfo) return { venue: "pumpswap", tokenProgram: tokenProgram?.toBase58() ?? null, complete: true, creator: null, pool: pool.toBase58(), progress: 1 };
  return { venue: "none", tokenProgram: tokenProgram?.toBase58() ?? null, complete: curveInfo ? true : null, creator: null, pool: null, progress: null };
}

export interface TradeQuote {
  venue: Venue;
  side: "buy" | "sell";
  /** Raw input (lamports for buy, token units for sell). */
  amountIn: string;
  /** Expected raw output before slippage. */
  expectedOut: string;
  /** Minimum raw output after slippage (sell) or maximum input (buy). */
  limit: string;
  slippagePct: number;
}

async function buildTx(user: PublicKey, ixs: TransactionInstruction[]) {
  const conn = rpc();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE }), ...ixs],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed" });
  return {
    transaction: toBase64(tx.serialize()),
    lastValidBlockHeight,
    simulation: { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed ?? null, logs: (sim.value.logs ?? []).slice(-12) },
  };
}

/** Build an unsigned buy/sell transaction for the connected wallet. */
export async function buildTrade(p: { mint: string; user: string; side: "buy" | "sell"; amount: bigint; slippagePct: number }) {
  if (p.amount <= 0n) throw new HttpError(400, "Amount must be positive");
  if (!(p.slippagePct > 0 && p.slippagePct <= 50)) throw new HttpError(400, "Slippage must be between 0 and 50%");
  const conn = rpc();
  const mint = new PublicKey(p.mint);
  const user = new PublicKey(p.user);
  const venue = await detectVenue(p.mint);
  const amount = new BN(p.amount.toString());

  if (venue.venue === "curve") {
    const sdk = new OnlinePumpSdk(conn);
    const tokenProgram = new PublicKey(venue.tokenProgram!);
    const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
    if (p.side === "buy") {
      const state = await sdk.fetchBuyState(mint, user, tokenProgram);
      const expected = getBuyV3TokenAmountFromQuoteAmount({
        global,
        feeConfig,
        mintSupply: state.bondingCurve.tokenTotalSupply,
        bondingCurve: state.bondingCurve,
        amount,
        curveBaseTokenBalance: state.curveBaseTokenBalance,
      });
      if (expected.isZero()) throw new HttpError(409, "This curve is not accepting buys (complete or migrating)");
      const ixs = await PUMP_SDK.buyExactQuoteInV3Instructions({
        bondingCurve: state.bondingCurve,
        associatedUserAccountInfo: state.associatedUserAccountInfo,
        mint,
        user,
        amount: expected,
        quoteAmount: amount,
        slippage: p.slippagePct,
        tokenProgram,
        quoteTokenProgram: state.quoteTokenProgram,
      });
      const minOut = expected.sub(expected.mul(new BN(Math.floor(p.slippagePct * 10))).div(new BN(1000)));
      const quote: TradeQuote = { venue: "curve", side: "buy", amountIn: amount.toString(), expectedOut: expected.toString(), limit: minOut.toString(), slippagePct: p.slippagePct };
      return { quote, ...(await buildTx(user, ixs)) };
    }
    const state = await sdk.fetchSellState(mint, user, tokenProgram);
    const expected = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount });
    const ixs = await PUMP_SDK.sellV3Instructions({
      bondingCurve: state.bondingCurve,
      mint,
      user,
      amount,
      quoteAmount: expected,
      slippage: p.slippagePct,
      tokenProgram,
      quoteTokenProgram: state.quoteTokenProgram,
    });
    const minOut = expected.sub(expected.mul(new BN(Math.floor(p.slippagePct * 10))).div(new BN(1000)));
    const quote: TradeQuote = { venue: "curve", side: "sell", amountIn: amount.toString(), expectedOut: expected.toString(), limit: minOut.toString(), slippagePct: p.slippagePct };
    return { quote, ...(await buildTx(user, ixs)) };
  }

  if (venue.venue === "pumpswap") {
    const amm = new OnlinePumpAmmSdk(conn);
    const state = await amm.swapSolanaState(new PublicKey(venue.pool!), user);
    if (!isSolQuote(state.pool.quoteMint)) throw new HttpError(400, "Only SOL-quoted pools are supported");
    const common = {
      slippage: p.slippagePct,
      baseReserve: state.poolBaseAmount,
      quoteReserve: state.poolQuoteAmount,
      globalConfig: state.globalConfig,
      baseMintAccount: state.baseMintAccount,
      baseMint: state.baseMint,
      coinCreator: state.pool.coinCreator,
      creator: state.pool.creator,
      feeConfig: state.feeConfig,
      quoteMint: state.pool.quoteMint,
      isMayhemMode: state.pool.isMayhemMode,
      creatorFeeBps: state.pool.creatorFeeBps,
    };
    if (p.side === "buy") {
      const q = buyQuoteInput({ quote: amount, ...common });
      const ixs = await PUMP_AMM_SDK.buyQuoteInput(state, amount, p.slippagePct);
      const quote: TradeQuote = { venue: "pumpswap", side: "buy", amountIn: amount.toString(), expectedOut: q.base.toString(), limit: q.maxQuote.toString(), slippagePct: p.slippagePct };
      return { quote, ...(await buildTx(user, ixs)) };
    }
    const q = sellBaseInput({ base: amount, ...common });
    const ixs = await PUMP_AMM_SDK.sellBaseInput(state, amount, p.slippagePct);
    const quote: TradeQuote = { venue: "pumpswap", side: "sell", amountIn: amount.toString(), expectedOut: q.uiQuote.toString(), limit: q.minQuote.toString(), slippagePct: p.slippagePct };
    return { quote, ...(await buildTx(user, ixs)) };
  }

  throw new HttpError(404, "No SOL-quoted Pump.fun curve or PumpSwap pool found for this token on this network");
}

/** Build an unsigned create_v2 (+ optional first buy) transaction. The mint key never leaves the browser. */
export async function buildLaunch(p: { mint: string; user: string; name: string; symbol: string; uri: string; initialBuyLamports: bigint }) {
  const conn = rpc();
  const sdk = new OnlinePumpSdk(conn);
  const mint = new PublicKey(p.mint);
  const user = new PublicKey(p.user);
  if (await conn.getAccountInfo(mint)) throw new HttpError(409, "Mint address already exists; generate a new one");
  let ixs: TransactionInstruction[];
  let expectedTokens: string | null = null;
  if (p.initialBuyLamports > 0n) {
    const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
    const quoteAmount = new BN(p.initialBuyLamports.toString());
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: quoteAmount, quoteMint: NATIVE_MINT });
    expectedTokens = amount.toString();
    ixs = await PUMP_SDK.createV2AndBuyV2Instructions({
      global,
      mint,
      name: p.name,
      symbol: p.symbol,
      uri: p.uri,
      creator: user,
      user,
      amount,
      quoteAmount,
      mayhemMode: false,
      slippage: 1,
    });
  } else {
    ixs = [await PUMP_SDK.createV2Instruction({ mint, name: p.name, symbol: p.symbol, uri: p.uri, creator: user, user, mayhemMode: false })];
  }
  const built = await buildTx(user, ixs);
  return { ...built, expectedTokens };
}
