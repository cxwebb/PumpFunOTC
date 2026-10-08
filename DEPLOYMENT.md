# Deployment

Target: **Vercel** (Node.js runtime) + **Supabase**.

1. **Supabase**: create a project. In the SQL editor run every file in `supabase/migrations/` in order. Copy the project URL and `service_role` key.
2. **Vercel**: import the GitHub repo. Framework preset: Next.js. Add every variable from `.env.example` in Project Settings > Environment Variables. Set `NEXT_PUBLIC_APP_DOMAIN` to the production host (e.g. `pumpfunotc.vercel.app`); orders and sign-ins are bound to it.
3. **RPC**: use a dedicated RPC (Helius) for `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL`; public endpoints rate-limit.
4. **Network**: keep `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` until the live devnet tests in TESTING.md pass. Mainnet requires both `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta` and `NEXT_PUBLIC_ALLOW_MAINNET=true`, and should wait for an independent security review.
5. Deploy. Check `/fees` shows your treasury and `/api/auth/me` returns `{"wallet":null}`.

Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `PINATA_JWT` and any RPC key must never be prefixed `NEXT_PUBLIC_`.
