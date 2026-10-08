# Testing

## 1. Automated (no network needed)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- `tests/settlement.test.ts` executes real settlement transactions on **LiteSVM** (in-process Solana runtime with the real System, SPL Token, Token-2022, Associated Token and Memo programs). Covers: atomic token/SOL/fee movement, tamper rejection, wallet-modified messages, missing signatures, insufficient tokens or SOL (nothing moves), expired blockhash, replay.
- `tests/migrations.test.ts` applies the Supabase migration to **PGlite** (in-process Postgres) and checks atomic claims, one active session per order, idempotent settlement recording, immutability and counteroffer rules.
- `tests/orders.test.ts`, `tests/amounts.test.ts`: order hashing/signing and integer amount math.

## 2. Live devnet

### 2a. Protocol only (two script wallets)

```bash
npm run devnet:otc-e2e
```

Creates `.devnet/seller|buyer|treasury.keypair.json` (gitignored, devnet only), mints a test token, settles 250 tokens for 0.1 SOL with both wallets signing the identical bytes, waits for `finalized`, and reconciles from the chain. Prints PASS/FAIL and an explorer link.

### 2b. Full app with two browser wallets

1. Configure `.env.local` (see README), apply the migration, `npm run dev`.
2. Create two wallets in Phantom (or Phantom + Solflare), switch both to **Devnet**, fund them at https://faucet.solana.com.
3. Get a test token into wallet A: e.g. `spl-token create-token --url devnet`, `spl-token create-account`, `spl-token mint` (or use `npm run devnet:otc-e2e`'s mint).
4. Wallet A: Sign in → OTC Desk → Create offer (ASK) for that mint.
5. Wallet B (other browser profile): open the offer → Buy now → sign as buyer.
6. Wallet A: Portfolio shows “Your signature is needed” → sign as seller (within ~60 s).
7. Expect: status goes Submitted → Settled; receipt page shows Verified; balances match; treasury received 0.5%.

Failure cases to try: let the blockhash expire (wait >90 s before the seller signs) → session expires and the offer reopens; cancel while the buyer has signed → nothing is submitted; accept twice from two tabs → second gets 409; counter an offer → parent shows Countered and only the newest is actionable.

## 3. Pump trading and launch

Requires Pump programs on the chosen cluster (unconfirmed for devnet). If testing on mainnet, use tiny amounts and set `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta` + `NEXT_PUBLIC_ALLOW_MAINNET=true` deliberately.
