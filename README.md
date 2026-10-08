# PumpFunOTC

A Solana trading platform: escrowless wallet-to-wallet OTC trading (the flagship), Pump.fun token discovery, bonding-curve and PumpSwap trading, a Pump.fun launchpad, a portfolio and chain-verified trade receipts.

> Unaudited software. Defaults to **devnet**. Do not use with funds you cannot afford to lose.

- Requirements and priorities: [`CLAUDE.md`](CLAUDE.md)
- Architecture and protocol: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What works today and what is verified: [`PROGRESS.md`](PROGRESS.md)
- How to test: [`TESTING.md`](TESTING.md) · How to deploy: [`DEPLOYMENT.md`](DEPLOYMENT.md)

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:3000
```

Minimum configuration to use the OTC desk on devnet:

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Create a Supabase project, then Project Settings > API. Apply the migration in `supabase/migrations/`. |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_OTC_TREASURY` | The public address of a wallet you control that should receive fees. |

Optional: `SOLANA_RPC_URL` (Helius recommended), `PINATA_JWT` (needed for the launchpad image/metadata upload).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (settlement runs on an in-process Solana runtime, the database migration runs on an in-process Postgres) |
| `npm run devnet:otc-e2e` | Live devnet two-wallet settlement against real Solana |

## Layout

```
src/app/            pages and API routes
src/modules/        shared logic (OTC orders, settlement builder/verifier, token safety, trading, market data)
src/server/         server-only services (Supabase, RPC, OTC engine, Pump integration, receipts)
src/client/         browser hooks (auth, API, balances)
src/components/     UI
supabase/migrations SQL schema, RLS and atomic OTC functions
tests/              vitest suites
scripts/            devnet end-to-end script
```
