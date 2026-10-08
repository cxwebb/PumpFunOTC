-- PumpFunOTC initial schema.
-- All writes go through the app server using the service role, which
-- bypasses RLS. RLS here only governs what the public (anon) key can read.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- identity
create table public.wallets (
  address text primary key,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.auth_challenges (
  nonce text primary key,
  wallet text not null,
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_challenges_wallet_idx on public.auth_challenges (wallet);

-- ---------------------------------------------------------------- tokens
create table public.tokens (
  mint text primary key,
  network text not null,
  token_program text not null,
  decimals int not null,
  name text,
  symbol text,
  image_url text,
  updated_at timestamptz not null default now()
);

create table public.launches (
  mint text primary key,
  network text not null,
  creator text not null,
  name text not null,
  symbol text not null,
  metadata_uri text not null,
  tx_signature text unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index launches_creator_idx on public.launches (creator);

-- ---------------------------------------------------------------- OTC orders
create table public.otc_orders (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  signature text not null,
  network text not null,
  side text not null check (side in ('sell', 'buy')),
  maker text not null,
  counterparty text,
  mint text not null,
  token_program text not null,
  decimals int not null,
  token_amount numeric(20, 0) not null check (token_amount > 0),
  lamports numeric(20, 0) not null check (lamports > 0),
  fee_bps int not null check (fee_bps between 0 and 1000),
  parent_hash text references public.otc_orders (hash),
  root_hash text not null,
  nonce text not null,
  expires_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'settling', 'countered', 'cancelled', 'filled', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (maker, nonce)
);
create index otc_orders_mint_status_idx on public.otc_orders (mint, status);
create index otc_orders_maker_idx on public.otc_orders (maker);
create index otc_orders_counterparty_idx on public.otc_orders (counterparty);
create index otc_orders_root_idx on public.otc_orders (root_hash);
-- Only one live counter per parent.
create unique index otc_orders_one_child_idx on public.otc_orders (parent_hash) where parent_hash is not null;

create table public.otc_cancellations (
  order_hash text primary key references public.otc_orders (hash),
  maker text not null,
  message text not null,
  signature text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- settlement
create table public.settlement_sessions (
  id uuid primary key default gen_random_uuid(),
  order_hash text not null references public.otc_orders (hash),
  network text not null,
  buyer text not null,
  seller text not null,
  taker text not null,
  terms jsonb not null,
  message_b64 text not null,
  message_sha256 text not null,
  recent_blockhash text not null,
  last_valid_block_height bigint not null,
  cu_limit int not null,
  cu_price_micro_lamports bigint not null,
  buyer_signature text,
  seller_signature text,
  tx_signature text unique,
  state text not null default 'awaiting_buyer'
    check (state in ('awaiting_buyer', 'awaiting_seller', 'submitting', 'submitted', 'settled', 'expired', 'failed', 'cancelled')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index settlement_sessions_order_idx on public.settlement_sessions (order_hash);
create index settlement_sessions_buyer_idx on public.settlement_sessions (buyer);
create index settlement_sessions_seller_idx on public.settlement_sessions (seller);
-- At most one live signing session per order.
create unique index settlement_sessions_one_active_idx on public.settlement_sessions (order_hash)
  where state in ('awaiting_buyer', 'awaiting_seller', 'submitting', 'submitted');

create table public.settlements (
  tx_signature text primary key,
  session_id uuid not null unique references public.settlement_sessions (id),
  order_hash text not null unique references public.otc_orders (hash),
  network text not null,
  buyer text not null,
  seller text not null,
  mint text not null,
  token_amount numeric(20, 0) not null,
  gross_lamports numeric(20, 0) not null,
  fee_lamports numeric(20, 0) not null,
  seller_net_lamports numeric(20, 0) not null,
  treasury text not null,
  slot bigint not null,
  block_time timestamptz,
  reconciliation jsonb not null,
  created_at timestamptz not null default now()
);
create index settlements_buyer_idx on public.settlements (buyer);
create index settlements_seller_idx on public.settlements (seller);
create index settlements_mint_idx on public.settlements (mint);

-- ---------------------------------------------------------------- audit/config
create table public.audit_events (
  id bigserial primary key,
  event text not null,
  actor text,
  subject text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_subject_idx on public.audit_events (subject);

create table public.platform_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- immutability
create or replace function public.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;

create trigger settlements_immutable before update or delete on public.settlements
  for each row execute function public.forbid_change();
create trigger cancellations_immutable before update or delete on public.otc_cancellations
  for each row execute function public.forbid_change();

create or replace function public.otc_orders_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'otc_orders rows cannot be deleted';
  end if;
  if new.hash <> old.hash or new.payload <> old.payload or new.signature <> old.signature
     or new.maker <> old.maker or new.token_amount <> old.token_amount or new.lamports <> old.lamports then
    raise exception 'signed order fields are immutable';
  end if;
  -- A transaction that lands on chain is the truth, so an expired order may still become filled.
  if old.status in ('filled', 'cancelled', 'countered') and new.status <> old.status then
    raise exception 'order % is final (%)', old.hash, old.status;
  end if;
  if old.status = 'expired' and new.status not in ('expired', 'filled') then
    raise exception 'order % is final (%)', old.hash, old.status;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger otc_orders_guard before update or delete on public.otc_orders
  for each row execute function public.otc_orders_guard();

create or replace function public.settlement_sessions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'settlement_sessions rows cannot be deleted';
  end if;
  if new.message_b64 <> old.message_b64 or new.terms <> old.terms or new.order_hash <> old.order_hash then
    raise exception 'settlement message is immutable';
  end if;
  if old.buyer_signature is not null and new.buyer_signature is distinct from old.buyer_signature then
    raise exception 'buyer signature already recorded';
  end if;
  if old.seller_signature is not null and new.seller_signature is distinct from old.seller_signature then
    raise exception 'seller signature already recorded';
  end if;
  if old.state in ('settled', 'cancelled') and new.state <> old.state then
    raise exception 'session % is final (%)', old.id, old.state;
  end if;
  if old.state in ('expired', 'failed') and new.state not in (old.state, 'settled') then
    raise exception 'session % is final (%)', old.id, old.state;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger settlement_sessions_guard before update or delete on public.settlement_sessions
  for each row execute function public.settlement_sessions_guard();

-- ---------------------------------------------------------------- atomic operations

-- Insert a counteroffer and retire its parent in one step.
create or replace function public.otc_post_counter(p_order jsonb) returns text language plpgsql as $$
declare
  v_parent text := p_order ->> 'parent_hash';
  v_updated int;
begin
  update public.otc_orders set status = 'countered'
    where hash = v_parent and status = 'open' and expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'parent order is not open' using errcode = 'P0001';
  end if;
  insert into public.otc_orders (hash, payload, signature, network, side, maker, counterparty, mint, token_program, decimals, token_amount, lamports, fee_bps, parent_hash, root_hash, nonce, expires_at)
    select hash, payload, signature, network, side, maker, counterparty, mint, token_program, decimals, token_amount, lamports, fee_bps, parent_hash, root_hash, nonce, expires_at from jsonb_populate_record(null::public.otc_orders, p_order);
  return p_order ->> 'hash';
end $$;

-- Claim an open order for settlement and create its signing session atomically.
create or replace function public.otc_claim_order(p_order_hash text, p_session jsonb) returns uuid language plpgsql as $$
declare
  v_updated int;
  v_id uuid;
begin
  update public.otc_orders set status = 'settling'
    where hash = p_order_hash and status = 'open' and expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'order is not open for settlement' using errcode = 'P0001';
  end if;
  insert into public.settlement_sessions
    (id, order_hash, network, buyer, seller, taker, terms, message_b64, message_sha256,
     recent_blockhash, last_valid_block_height, cu_limit, cu_price_micro_lamports, state)
  values
    ((p_session ->> 'id')::uuid, p_order_hash, p_session ->> 'network', p_session ->> 'buyer',
     p_session ->> 'seller', p_session ->> 'taker', p_session -> 'terms', p_session ->> 'message_b64',
     p_session ->> 'message_sha256', p_session ->> 'recent_blockhash',
     (p_session ->> 'last_valid_block_height')::bigint, (p_session ->> 'cu_limit')::int,
     (p_session ->> 'cu_price_micro_lamports')::bigint, 'awaiting_buyer')
  returning id into v_id;
  return v_id;
end $$;

-- End a session that did not settle; reopen the order if it is still valid.
create or replace function public.otc_end_session(p_session_id uuid, p_state text, p_error text) returns void language plpgsql as $$
declare
  v_order text;
begin
  if p_state not in ('expired', 'failed', 'cancelled') then
    raise exception 'invalid terminal state %', p_state;
  end if;
  update public.settlement_sessions set state = p_state, error = p_error
    where id = p_session_id and state in ('awaiting_buyer', 'awaiting_seller', 'submitting', 'submitted')
    returning order_hash into v_order;
  if v_order is null then
    return;
  end if;
  update public.otc_orders
    set status = case when expires_at > now() then 'open' else 'expired' end
    where hash = v_order and status = 'settling';
end $$;

-- Record a chain-verified settlement. Idempotent on tx signature.
-- Insert an original (non-counter) order.
create or replace function public.otc_insert_order(p_order jsonb) returns text language plpgsql as $$
begin
  if p_order ->> 'parent_hash' is not null then
    raise exception 'use otc_post_counter for counteroffers';
  end if;
  insert into public.otc_orders (hash, payload, signature, network, side, maker, counterparty, mint, token_program, decimals, token_amount, lamports, fee_bps, parent_hash, root_hash, nonce, expires_at)
    select hash, payload, signature, network, side, maker, counterparty, mint, token_program, decimals, token_amount, lamports, fee_bps, parent_hash, root_hash, nonce, expires_at from jsonb_populate_record(null::public.otc_orders, p_order);
  return p_order ->> 'hash';
end $$;

create or replace function public.otc_record_settlement(p_settlement jsonb) returns void language plpgsql as $$
declare
  v_session uuid := (p_settlement ->> 'session_id')::uuid;
begin
  if exists (select 1 from public.settlements where tx_signature = p_settlement ->> 'tx_signature') then
    return;
  end if;
  insert into public.settlements (tx_signature, session_id, order_hash, network, buyer, seller, mint, token_amount, gross_lamports, fee_lamports, seller_net_lamports, treasury, slot, block_time, reconciliation)
    select tx_signature, session_id, order_hash, network, buyer, seller, mint, token_amount, gross_lamports, fee_lamports, seller_net_lamports, treasury, slot, block_time, reconciliation from jsonb_populate_record(null::public.settlements, p_settlement);
  update public.settlement_sessions set state = 'settled'
    where id = v_session and state in ('submitting', 'submitted', 'awaiting_seller', 'expired', 'failed');
  update public.otc_orders set status = 'filled'
    where hash = p_settlement ->> 'order_hash' and status in ('settling', 'open', 'expired');
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.wallets enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.tokens enable row level security;
alter table public.launches enable row level security;
alter table public.otc_orders enable row level security;
alter table public.otc_cancellations enable row level security;
alter table public.settlement_sessions enable row level security;
alter table public.settlements enable row level security;
alter table public.audit_events enable row level security;
alter table public.platform_config enable row level security;

-- Public reads: public offers, settled trades, launches, token cache.
create policy "public offers are readable" on public.otc_orders
  for select to anon, authenticated using (counterparty is null);
create policy "settlements are public receipts" on public.settlements
  for select to anon, authenticated using (true);
create policy "launches are public" on public.launches
  for select to anon, authenticated using (status = 'confirmed');
create policy "token cache is public" on public.tokens
  for select to anon, authenticated using (true);

-- Only the server (service role) may call the state-changing functions.
revoke execute on function public.otc_insert_order(jsonb) from public, anon, authenticated;
grant execute on function public.otc_insert_order(jsonb) to service_role;
revoke execute on function public.otc_post_counter(jsonb) from public, anon, authenticated;
revoke execute on function public.otc_claim_order(text, jsonb) from public, anon, authenticated;
revoke execute on function public.otc_end_session(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.otc_record_settlement(jsonb) from public, anon, authenticated;
grant execute on function public.otc_post_counter(jsonb) to service_role;
grant execute on function public.otc_claim_order(text, jsonb) to service_role;
grant execute on function public.otc_end_session(uuid, text, text) to service_role;
grant execute on function public.otc_record_settlement(jsonb) to service_role;
