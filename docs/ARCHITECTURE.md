# Architecture — Solana OTC + Launch + Trading Platform

Status: proposed, 2026-10-07. Companion to `CLAUDE.md` (which remains the source of truth for scope). This file moves into the repo as `docs/ARCHITECTURE.md` once one exists.

## 1. What was checked

| Item | Finding | Evidence |
|---|---|---|
| Project files | Only `CLAUDE.md`. No repo, no `package.json`, no existing code. Greenfield. | `/mnt/project-files/` listing |
| Desk 404 site | Pages: Explore, OTC Desk, Launch, Portfolio, Help (`/docs`), token chart. Runs on mainnet. | desk404.fun, desk404.fun/docs (fetched 2026-10-07) |
| Desk 404 OTC protocol | Signed off-chain orders (SHA-256 of canonical JSON, nonce + salt, network/domain). Counters are new signed orders bound to the parent hash; only newest revision is actionable. Cancel = signed message. One settlement tx, buyer signs first, seller second. 0.5% OTC fee, no fee on Pump trades. | desk404.fun/docs |
| Desk 404 settlement tx | Compute budget → buyer ATA create (idempotent, buyer pays) → Memo `otc-settlement:v1:<orderHash>:<settlementId>` → `TransferChecked` seller→buyer → SOL buyer→seller, buyer→treasury (→ referrer). Browser allow-lists only System, Token, Token-2022, ATA, Memo, Compute Budget; no lookup tables; exactly 2 signers. | desk404.fun/docs |
| Desk 404 launch/trade | Launch via Pump `create_v2` (Token-2022 mint, keypair generated in browser, optional atomic first buy). Curve buys `buy_exact_quote_in_v2`, sells `sell_v2`; graduated coins via PumpSwap; venue detected from chain state; SOL-quoted only. Refuses risky Token-2022 extensions. | desk404.fun/docs |
| `@pump-fun/pump-sdk` | v3.2.0 (published 2026-10-07, very active). Official. Has `createV2Instruction`, `createV2AndBuyV2Instructions`, `buyV2Instructions`, `sellV2Instructions`, `OnlinePumpSdk` (fetches curve/global state), quote math (`getBuyTokenAmountFromSolAmount`, `getSellSolAmountFromTokenAmount`), `isBondingCurveMigrated`. v3 instructions also exist. Built on `@solana/web3.js` v1 + Anchor 0.31 + bn.js. | npm pack + `dist/index.d.ts` |
| `@pump-fun/pump-swap-sdk` | v2.1.0. Official PumpSwap AMM SDK (program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`). | npm |
| Solana SDKs | `@solana/web3.js` 1.99.0, `@solana/kit` 8.4.0, `@solana/spl-token` 0.4.15, wallet-adapter-react 0.15.40, Next.js 16.4, supabase-js 2.117. | npm view |
| Pump on devnet | **Not verified.** The SDK references devnet USDC and devnet program ids for side programs, which suggests a devnet deployment, but this container cannot reach Solana RPC to confirm. | see §8 |

## 2. Build vs. buy

| Capability | Existing API/SDK | Custom work |
|---|---|---|
| Wallet connect | Solana wallet-adapter (Phantom, Solflare, Wallet Standard) | Sign-in-with-Solana challenge/response, session cookie |
| OTC orders, negotiation, cancel | None. This is our product. | All of it: order schema, canonical hashing, signing, verification, state machine, realtime |
| OTC settlement | System Program, SPL Token/Token-2022 `TransferChecked`, ATA, Memo, Compute Budget instructions | Tx builder, independent client-side verifier, signing session coordinator, broadcast, confirmation, reconciliation, locks |
| Receipts | RPC `getTransaction` | Decoder that re-derives the expected message and checks balances |
| Pump curve trading | `@pump-fun/pump-sdk` (quotes + instructions) | Venue detection, slippage UI, simulation, confirmation |
| PumpSwap trading | `@pump-fun/pump-swap-sdk` | Same UI layer as above |
| Launch | `@pump-fun/pump-sdk` `createV2AndBuyV2Instructions` | Form, metadata/image upload, browser mint keypair, cost disclosure |
| Metadata/IPFS upload | Pump's own IPFS endpoint (unofficial) or Pinata/Irys (official, needs key) | Upload route with validation |
| Token discovery, price, volume, charts | No official Pump data API. Options: Helius (RPC + DAS + parsed Pump events/webhooks), Birdeye or DexScreener/GeckoTerminal for prices/OHLCV, Pump.fun frontend API (unofficial, may break) | Indexer that listens to Pump create/trade events and stores tokens; aggregation for trending/near-graduation |
| Balances/portfolio | Helius DAS `getAssetsByOwner` or RPC `getTokenAccountsByOwner` | Join with our orders, trades, launches |
| Charts | TradingView Lightweight Charts | Candle feed from vendor or our own trade index |

## 3. Stack decisions

- **Next.js 16 App Router + TypeScript (strict) + Tailwind**, single app, deployed on Vercel.
- **`@solana/web3.js` v1, not `@solana/kit`**, for now. Both Pump SDKs and wallet-adapter are built on v1, and mixing the two doubles the transaction types we must verify. Revisit when the Pump SDKs move.
- **Pin exact versions** of the Pump SDKs. They publish several times a week and have already added v3 instructions; any upgrade goes through a devnet test.
- **Supabase**: Postgres, Realtime for the order book and signing sessions, RLS. All writes that matter go through our server (service role) so business rules live in one place; the browser reads public data directly.
- **Auth**: Sign-In-With-Solana message (domain, nonce, expiry, chain) signed by the wallet, verified server-side with Ed25519, then an httpOnly session cookie. Wallet address alone is never identity.
- **RPC/indexer: Helius** (devnet + mainnet in one account, DAS, parsed Pump events, webhooks).
- **Market data**: Helius for chain data, plus one price/OHLCV vendor (Birdeye is the default pick; DexScreener as free fallback). Unavailable values are shown as unavailable, never estimated silently.
- **Zod** at every boundary. **`bigint`** for lamports and raw token amounts everywhere; decimals only for display.
- **Tests**: Vitest for unit (hashing, tx build/verify, fee math), Playwright for UI, and a devnet integration script that runs a real two-wallet settlement.

## 4. Code layout

```
app/                       routes: /, /explore, /token/[mint], /launch, /otc,
                           /offer/[id], /trade/[id], /receipt/[signature],
                           /portfolio, /help, /fees, api/*
src/modules/
  auth/                    SIWS challenge, session
  wallet/                  adapter provider, network guard (devnet default)
  tokens/                  mint info, Token-2022 extension safety check
  market-data/             vendor adapters behind one interface
  trading/                 venue detection, Pump curve + PumpSwap quotes/tx
  launch/                  metadata upload, create_v2 tx
  otc/orders/              schema, canonical JSON, hash, sign, verify
  otc/negotiations/        counters, revision chain, cancel
  otc/settlement/          builder, verifier (shared client+server), session, broadcast, reconcile
  portfolio/
  receipts/                chain decoder
src/lib/                   bigint math, zod schemas, rpc client, env
supabase/migrations/       SQL + RLS
```

The **settlement verifier is one pure module** imported by both the browser (before each wallet prompt) and the server (before storing a signature and before broadcast). It rebuilds the expected message from the signed order and compares bytes.

## 5. OTC protocol (v1)

**Order** (canonical JSON, keys sorted, bigint as decimal strings): `domain`, `network`, `version`, `side` (ask/bid), `maker`, `mint`, `tokenProgram`, `decimals`, `tokenAmount`, `lamports`, `feeBpsMax`, `counterparty` (null = public), `partialFill` (v1: `none`), `parentHash` (counters), `expiresAt`, `nonce`, `salt`. `orderHash = sha256(canonicalJson)`. The maker signs a human-readable message ending with the hash (wallet `signMessage`, not a transaction).

**Lifecycle**: `open → (countered | cancelled | expired | settling) → settled`. Only the newest revision in a chain is actionable. Cancel is a signed message checked against the maker.

**Settlement session**:
1. Taker accepts. Server takes a row lock on the order (`settling`, one active session per order), re-checks seller token balance, buyer SOL, mint extensions.
2. Server builds the tx with a fresh blockhash; stores exact message bytes and their hash.
3. Buyer's browser rebuilds the expected message from the order and compares; buyer signs (fee payer). Server verifies the Ed25519 signature over the stored bytes.
4. Seller's browser does the same check, signs. Server verifies both signatures, simulates, broadcasts, then confirms.
5. Order becomes `settled` **only** after the server reads the confirmed transaction and reconciles actual balance changes against the order. Client claims of success are ignored.
6. Blockhash expiry: session retired once `lastValidBlockHeight` passes; a new session means new bytes and new signatures. Old signatures are never reused.

**Fee**: 0.5% of gross lamports (integer math, rounded down), paid from buyer outlay to a treasury address read from server config only. Seller net = gross − fee. Both the signed order (`feeBpsMax`) and the tx carry it.

**Token support v1**: SPL Token, and Token-2022 only with no transfer hook, permanent delegate, non-transferable, confidential transfer, or default-frozen state. Transfer-fee tokens deferred until tested.

**Partial fills**: off in v1. Shipping them requires a fresh maker signature per fill; designed later.

## 6. Database (Supabase)

`wallets`, `auth_challenges` (nonce, expiry, used_at), `sessions`, `tokens`, `launches`, `otc_orders` (immutable signed payload + hash + status), `otc_cancellations`, `settlement_sessions` (message bytes, blockhash, last valid height, buyer/seller signatures, state), `settlements` (confirmed signature, reconciled amounts; immutable), `audit_events`, `platform_config` (fee bps, treasury). Unique constraints: order hash, nonce per maker, one active session per order, one settlement per tx signature.

## 7. Delivery milestones (from CLAUDE.md §6)

1. Skeleton: all routes, wallet connect, SIWS auth, Supabase migrations, devnet guard.
2. OTC orders + negotiation with real signatures and persistence.
3. Two-wallet devnet settlement + chain-verified receipt. **Flagship gate.**
4. Fees, bids, private offers, expiry/retry, concurrency tests.
5. Explore, token page, portfolio with real data.
6. Pump launch + curve trading + PumpSwap.
7. QA, docs, production build, deploy.

## 8. Risks and open items

- **Pump on devnet unverified.** If Pump/PumpSwap are mainnet-only, launch and spot trading can only be tested on mainnet with tiny amounts, which needs Connor's explicit go-ahead each time. OTC settlement is unaffected (it uses only core Solana programs; we mint our own devnet test tokens).
- **This cloud container's network policy blocks Solana RPC** (devnet and mainnet returned 403 at the proxy). Code and unit tests work; live devnet tests need the RPC host allowed or must run on Connor's machine.
- **Pump SDK churn**: pin versions; wrap SDK calls in `trading/` and `launch/` so changes stay local.
- **No official Pump discovery API**: trending/new lists depend on Helius events or a third-party vendor.
- **Escrowless means not guaranteed to fill.** The UI must say so plainly.
- **No audit.** Default devnet; mainnet requires explicit opt-in and a warning.
