# Solana OTC + Launch + Trading Platform — Claude Code Project Context

> This file is the persistent source of project context for Claude Code. Read it at the beginning of every working session. Update `PROGRESS.md` as work changes; do not rewrite the user's scope or silently declare unfinished features complete.

## 1. Mission

Build a complete, original, web-based Solana platform inspired by the **functional capabilities** of Desk 404 (`https://www.desk404.fun/`), with **escrowless OTC trading as the flagship feature**, plus token discovery, token detail/trading, Pump.fun token launch, portfolio, settlement receipts, and help/fees pages.

**The user wants the whole platform, not an OTC-only demo.** The user prioritizes fastest possible usable MVP, expects to fix bugs and upgrade rapidly, and wants Claude Code to directly implement code rather than provide only plans. Aim for a deployable integrated application, while never treating untested financial transactions as safe.

Do not copy Desk 404 branding, assets, proprietary code or claim that implementation is identical. Inspect public pages/docs where accessible, and consult current official Solana/Pump documentation for protocol interfaces. If the reference site is inaccessible, proceed using this specification; clearly label unverified differences.

## 2. Working rules

- Inspect repository, package manager, existing code, and environment before changing architecture.
- Act as lead full-stack engineer: implement, install, typecheck, test, build, and fix normal errors independently.
- Avoid repeated permission requests or routine clarifying questions. Ask only for real external blockers: credentials, external service access, wallet confirmations, deployments requiring user authorization.
- Do not stop at mock screens. Connect real data and real blockchain flows; disclose explicitly any simulated/dev-only adapters.
- Maintain `PROGRESS.md` with per-feature statuses (`DONE`, `TESTED`, `PARTIAL`, `BLOCKED`, `NOT STARTED`), evidence of actual tests, next tasks, and blockers.
- Maintain `.env.example`, `README.md`, `TESTING.md`, `DEPLOYMENT.md`.
- Keep commits or clear milestones as useful working checkpoints. Avoid large rewrites when focused improvements suffice.
- Favor minimal infrastructure and rapid iteration, but never shortcut transaction verification or financial security.
- Never request, store or transmit user seed phrases/private keys; user wallets sign locally.
- Default network to **Solana devnet**; require explicit opt-in for mainnet execution. Never claim audit status or safe handling of significant funds.

## 3. Overall functional scope (ALL modules are in MVP scope)

### A. Explore `/explore` (also homepage `/`)
- Search Solana tokens by address, symbol, name.
- Trending/new Pump tokens, platform launches, near-graduation and graduated tokens (as data supports).
- Token metrics: price, market cap, liquidity, volume, recent activity (clearly distinguish unavailable/estimated values).
- Filters/sorting and active OTC offers/discounts; links to token detail and OTC desk.
- Use reliable indexed/chain data, not fabricated values.

### B. Token detail & spot trading `/token/[mint]`
- Real metadata, price/candlestick chart, mint address, balances, market/liquidity metrics, recent activity where available.
- Genuine Pump bonding curve buys/sells before graduation and PumpSwap trading after graduation, using verified current SDKs/routes.
- Quotes, slippage, fees, simulation where supported, wallet confirmation, explorer transaction links.
- OTC listings for that token and CTA to create an offer.

### C. Launchpad `/launch`
- Token name, ticker, description, image, links, validated metadata/IPFS upload.
- Browser-local mint keypair generation and real Pump-compatible launch transaction(s), with optional initial buy if supported.
- Explicit protocol costs, irreversible settings, chain confirmation, successful launch listing.
- Do not invent instruction layouts or assume a specific Pump SDK API without verifying current docs.

### D. Full OTC desk `/otc`, `/offer/[id]`, `/trade/[id]`
- Public asks/bids and private counterparty-specific offers.
- Token, raw quantity, SOL price, approximate implied unit price, expiry, partial-fill terms (only with sound safeguards).
- Signed off-chain maker orders, private negotiations, counteroffers linked to parent order hash, cancellation.
- Maker offer list, pending sessions, histories, token-filtered order book, trade status progression.
- Real-time updates or a robust polling fallback. Clear indication that escrowless offers are **not guaranteed to fill** and maker must participate in settlement.

### E. Atomic OTC settlement (flagship)
- No custody or escrow: buyer and seller each sign **the identical immutable Solana transaction message**; exchange SPL tokens for SOL atomically.
- Confirm exact maker/taker, correct token mint/program/accounts, raw amounts, SOL gross/net, explicit fee, fee payer, rent, permitted programs, and required signers.
- Buyer as default fee payer; idempotently create recipient ATA if needed. Supported token accounts only; reject unsupported Token-2022 extensions, transfer hooks or special behaviors until validated.
- Verify transaction instructions and message hash independently **before each signature**; verify all required Ed25519 signatures before broadcast.
- Short-lived blockhash sessions, timeouts, no silent signature reuse when expired, no modifications after partial signatures.
- Chain-confirmed settlement receipts, reconciled actual transfers, transaction signature; status never marked filled from client claims alone.
- Concurrency/lock safeguards against multiple active settlements and duplicate recording; idempotent reconciliation. No promise of enforceable on-chain cancellation of already signed executable transactions.
- Signed order messages use explicit domain/network separation, version, nonce, maker, side, mint, token program, raw amounts, lamports, expiry, fee maximum, counterparty, partial-fill rules, and deterministic canonical hash.
- Partial fills require fresh maker authorization of each fill (or a separately engineered audited/on-chain order program); do not assume a reusable off-chain signature is a secure fill authorization.

### F. Fees
- Support transparent configurable OTC fee (target default **0.5%**) in SOL, deducted from seller proceeds only when disclosed and explicitly agreed in both signed terms and settlement transaction.
- Show gross, fee, net seller proceeds, buyer outlay, network/rent costs. Do not invent or reuse third-party treasury addresses.
- Zero hidden fees. Test fees on devnet; ensure no money can be redirected by user-supplied treasury fields.

### G. Portfolio `/portfolio`
- Connected wallet SOL and token balances, values where trustworthy, token links.
- Open offers, pending negotiations, completed OTC trades, platform launches, transaction history.
- No fabricated cost basis or P&L.

### H. Public receipts `/receipt/[signature]`, help, fees
- Verify completion from blockchain and show token/SOL transfer details, wallet identities, platform fees, order/session identifier where available, explorer link.
- Explain escrowless risks, maker availability, fees, expiries and signature process.
- Responsive original dark terminal UI with useful loading/empty/error states.

## 4. Suggested stack

- Next.js App Router + TypeScript + Tailwind CSS.
- Solana wallet adapter for Phantom/Solflare; compatible official Solana Web3/SPL-Token SDKs.
- Official Pump SDK/instructions and PumpSwap integration where available; verify current APIs.
- Supabase Postgres, Realtime, RLS; signed-wallet challenge/response authentication with nonce/expiry and secure sessions.
- Helius or comparable Solana RPC/indexer; reliable token market data vendor where needed.
- Lightweight Charts (or maintained alternative), metadata uploader/IPFS.
- Zod for validation; `bigint` for token raw amounts and SOL lamports. **No JS floats for settlement math**.
- Vercel-compatible deployment.

These choices are defaults, not an invitation to rewrite a sound existing implementation.

## 5. Architecture and database

Separate modules for `auth`, `wallet`, `tokens`, `market-data`, `trading`, `launch`, `otc/orders`, `otc/negotiations`, `otc/settlement`, `portfolio`, and `receipts`.

Database tables (adapt to existing schema): wallet identities/auth challenges, tokens, launches, OTC orders, signed revisions/counteroffers, cancellations, trade sessions, transient signing progress, verified fills, settlement receipts, audit events, platform configuration. Enforce RLS, proper access controls, indexes, validation, atomic session claims, nonce replay prevention and immutable settled records.

Never trust an unverified wallet address as proof of identity. Never trust a client-supplied transaction, price, fee destination, order state, signature, or completion flag. Validate RPC response context and confirmation status.

## 6. Fastest delivery order

1. **Skeleton across full platform**: all navigation/pages, wallet connect, environment setup, database migrations, authentication, real persistence.
2. **OTC offers + negotiation**: create, browse, sign, verify, accept, cancel, counteroffer; persist data.
3. **OTC end-to-end devnet settlement**: two independently controlled wallets, token-for-SOL atomic transaction, secure signing coordination, chain-verified receipt.
4. **OTC completion**: fees, bids, private offers, stale/retry/expiry handling, concurrency, safe partial fills or clearly blocked partial fills.
5. **Explore + portfolio + token pages**: real token indexing, balances, live data, chart, listings.
6. **Launch + spot trading**: Pump launches, Pump bonding-curve trading, PumpSwap routes.
7. **Integration, QA, deployment**: responsive interface, errors, security checks, production build, docs and live devnet tests.

Implement independent UI modules in parallel if coding agents are available, but enforce shared interfaces and avoid concurrent edits to shared files. Continue work on other features if one vendor key or integration is blocked.

## 7. Acceptance criteria

- A new user can connect wallet and authenticate securely.
- Maker can create a real persisted and cryptographically signed OTC offer; other user can see and accept it.
- Buyer and seller, using **two distinct wallets on devnet**, each sign the same verified message; one valid finalized tx transfers correct SPL tokens and SOL atomically; receipt checks chain state.
- Signing failure, invalid destination, changed instructions, insufficient funds, expired blockhash, double acceptance, unauthorized cancellation and repeated callbacks fail safely.
- Public/private bids/asks and counteroffers work, fees are explicit, historical completed trades reflect verified transactions.
- Explore, token page, portfolio, token launcher and trading routes have real working supported integrations; anything blocked or mocked is labeled.
- `npm run typecheck` (or equivalent), lint, tests and production build pass; record results without fabrication.
- Documentation identifies unfinished, untested, and mainnet-risky features. Do not claim production-ready security without independent review.

## 8. Session instructions to Claude Code

At the start of each session:
1. Read this file, then `PROGRESS.md`, `README.md` and relevant files.
2. Summarize the **next concrete implementation milestone in 3–6 lines**, then immediately implement it.
3. Prefer tool use and code changes to extended discussion.
4. Run relevant tests, resolve ordinary failures, and update `PROGRESS.md` with precisely what was verified.
5. If blocked by credentials, describe **one specific user action needed** and work on independent tasks.

**Do not downscope this project to a simple OTC demo. Build the whole platform while getting OTC settlement genuinely functional first.**
