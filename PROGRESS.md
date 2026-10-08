# Progress

Status key: `DONE` (built, not live-tested) · `TESTED` (automated tests pass) · `PARTIAL` · `BLOCKED` · `NOT STARTED`.
Nothing below has been run against live Solana devnet or a live Supabase project yet: the build environment cannot reach Solana RPC, Supabase, DexScreener, GeckoTerminal or Pinata. "TESTED" means tested in-process (see evidence).

_Last updated: 2026-10-08 (milestone 1)._

## Verification evidence (milestone 1)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 problems |
| `npm test` | 31 tests pass (4 files) |
| `npm run build` | pass (Next.js 16.4, Turbopack) |
| Production server smoke test | all 10 pages render in headless Chromium with no client exceptions; API returns 503 with the missing variable names when Supabase is not configured |
| `npm run devnet:otc-e2e` | **not run**: Solana RPC is blocked from the build environment. Must be run on a machine with internet. |

## Features

| Area | Feature | Status | Notes |
|---|---|---|---|
| Platform | Next.js 16 app, routing, dark terminal UI | DONE | All pages in CLAUDE.md §3 exist. |
| Platform | Wallet connect (Wallet Standard: Phantom, Solflare, Backpack…) | DONE | Not tested with a real wallet extension. |
| Platform | Sign-in with Solana (nonce, expiry, single use) + httpOnly JWT session | DONE | Needs `SESSION_SECRET` and Supabase. |
| Platform | Supabase schema, RLS, atomic OTC functions, immutability triggers | TESTED | Migration applied to in-process Postgres; claim/expire/record/counter/duplicate-nonce/immutability tested. Not yet applied to a real Supabase project. |
| Platform | Devnet default, mainnet opt-in guard | DONE | Mainnet needs `NEXT_PUBLIC_ALLOW_MAINNET=true`. |
| OTC | Signed orders (canonical JSON, SHA-256 hash, domain/network/nonce/expiry/fee/treasury) | TESTED | Hash stability, tamper detection, wrong-signer rejection. |
| OTC | Public and private offers, asks and bids | DONE | |
| OTC | Counteroffers bound to parent hash, newest-revision-only | TESTED | Rules unit-tested; one-live-counter enforced in DB. |
| OTC | Signed cancellation; stops live signing sessions | DONE | |
| OTC | Expiry (lazy expiry on reads, refused at accept) | DONE | |
| OTC | Partial fills | BLOCKED (by design) | v1 is all-or-nothing. Needs fresh maker signature per fill. |
| OTC | Atomic settlement transaction builder | TESTED | Executed on LiteSVM with the real System, SPL Token, Token-2022, ATA and Memo programs: correct token/SOL/fee movement for both token programs. |
| OTC | Independent browser + server verifier (byte rebuild + semantic decode) | TESTED | Rejects changed amounts, redirected fee, flipped byte, fee above maximum, wallet-modified message. |
| OTC | Failure safety | TESTED | Seller lacks tokens → nothing moves; buyer lacks SOL → nothing moves; expired blockhash rejected; replay rejected; one signature cannot broadcast. |
| OTC | Signing session coordination (buyer first, seller second, blockhash expiry, retire and rebuild) | DONE | Logic in `src/server/otc.ts`; needs a live run. |
| OTC | Broadcast, finalized confirmation, chain reconciliation, receipt | PARTIAL | Reconciler tested against an RPC-shaped response; live path untested. |
| OTC | 0.5% fee from seller proceeds to configured treasury | TESTED | Fee math and treasury pinning tested; needs devnet run. |
| Receipts | `/receipt/[signature]` rebuilt from chain | DONE | |
| Explore | Trending, new Pump launches, bonding curve, graduated, search, launched-here, active offers | DONE | DexScreener (mainnet). Response shapes taken from DexScreener's published reference; not yet seen live. |
| Token page | Metrics, candles, on-chain facts, OTC listings, settled trades | DONE | Candles from GeckoTerminal (mainnet). |
| Trading | Pump bonding-curve buy (`buy_exact_quote_in_v3`) / sell (`sell_v3`) | DONE | `@pump-fun/pump-sdk` 3.2.0. Server builds and simulates; browser verifies and wallet signs. Untested live. |
| Trading | PumpSwap buy/sell for graduated tokens | DONE | `@pump-fun/pump-swap-sdk` 2.1.0. Untested live. |
| Launch | Metadata + image to IPFS (Pinata), browser-generated mint key, `create_v2` + optional atomic first buy | DONE | Needs `PINATA_JWT`. Untested live. |
| Portfolio | SOL/token balances, signatures needed, open offers, completed trades, offer history, launches, recent transactions | DONE | |
| Help / Fees | Escrowless risks, signing process, fee table | DONE | |

## Blockers (one action each)

1. **Supabase**: create a project, run `supabase/migrations/20261008000000_init.sql` in the SQL editor, and add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` / Vercel.
2. **Treasury**: choose the fee wallet and set `NEXT_PUBLIC_OTC_TREASURY` to its public address.
3. **Live devnet test**: run `npm run devnet:otc-e2e` on a machine with internet (fund the printed addresses from https://faucet.solana.com if the airdrop is rate-limited).
4. **Launchpad**: add `PINATA_JWT`.
5. **Pump on devnet**: unconfirmed whether Pump.fun/PumpSwap programs are deployed on devnet. If not, launch/trade can only be tested on mainnet with small amounts and explicit opt-in.

## Next tasks

1. Live devnet run of the full app OTC flow with two browser wallets (TESTING.md §2).
2. Supabase Realtime for order book and signing sessions (currently polling every 3–15 s).
3. Hardening: rate limiting on API routes, server-side request logging, monitoring for stuck `submitting` sessions.
4. Pump curve/PumpSwap live test; adjust instruction allowlist if the SDK emits extra programs.
5. Indexed history of platform launches and OTC volume for Explore ranking.
