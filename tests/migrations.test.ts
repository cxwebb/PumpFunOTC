/**
 * Applies the real Supabase migration to an in-process Postgres (PGlite)
 * and exercises the atomic OTC functions and immutability guards.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

const dir = join(__dirname, "..", "supabase", "migrations");
let db: PGlite;

const H = (c: string) => c.repeat(64);
function orderRow(hash: string, extra: Record<string, unknown> = {}) {
  return {
    hash,
    payload: { v: hash },
    signature: "sig",
    network: "devnet",
    side: "sell",
    maker: "maker1",
    counterparty: null,
    mint: "mint1",
    token_program: "tp",
    decimals: 6,
    token_amount: "1000",
    lamports: "5000",
    fee_bps: 50,
    parent_hash: null,
    root_hash: hash,
    nonce: hash.slice(0, 32),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    status: "open",
    ...extra,
  };
}

async function insertOrder(row: ReturnType<typeof orderRow>) {
  await db.query("select otc_insert_order($1::jsonb)", [JSON.stringify(row)]);
}

function session(id: string) {
  return {
    id,
    network: "devnet",
    buyer: "b",
    seller: "maker1",
    taker: "b",
    terms: {},
    message_b64: "AA==",
    message_sha256: "x",
    recent_blockhash: "bh",
    last_valid_block_height: 100,
    cu_limit: 1,
    cu_price_micro_lamports: 1,
  };
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

describe("migration", () => {
  it("claims an order once and blocks a second active session", async () => {
    await insertOrder(orderRow(H("a")));
    const id1 = "00000000-0000-4000-8000-000000000001";
    await db.query("select otc_claim_order($1, $2::jsonb)", [H("a"), JSON.stringify(session(id1))]);
    const st = await db.query<{ status: string }>("select status from otc_orders where hash=$1", [H("a")]);
    expect(st.rows[0].status).toBe("settling");
    await expect(
      db.query("select otc_claim_order($1, $2::jsonb)", [H("a"), JSON.stringify(session("00000000-0000-4000-8000-000000000002"))]),
    ).rejects.toThrow(/not open/);
    // ending the session reopens the order
    await db.query("select otc_end_session($1, 'expired', 'blockhash expired')", [id1]);
    const st2 = await db.query<{ status: string }>("select status from otc_orders where hash=$1", [H("a")]);
    expect(st2.rows[0].status).toBe("open");
    // a fresh session can now be created
    await db.query("select otc_claim_order($1, $2::jsonb)", [H("a"), JSON.stringify(session("00000000-0000-4000-8000-000000000003"))]);
  });

  it("records settlement idempotently and makes it immutable", async () => {
    const sid = "00000000-0000-4000-8000-000000000003";
    await db.query("update settlement_sessions set buyer_signature='s1', seller_signature='s2', state='submitted', tx_signature='tx1' where id=$1", [sid]);
    const s = {
      tx_signature: "tx1",
      session_id: sid,
      order_hash: H("a"),
      network: "devnet",
      buyer: "b",
      seller: "maker1",
      mint: "mint1",
      token_amount: "1000",
      gross_lamports: "5000",
      fee_lamports: "25",
      seller_net_lamports: "4975",
      treasury: "t",
      slot: 5,
      block_time: null,
      reconciliation: {},
    };
    await db.query("select otc_record_settlement($1::jsonb)", [JSON.stringify(s)]);
    await db.query("select otc_record_settlement($1::jsonb)", [JSON.stringify(s)]);
    const n = await db.query<{ c: number }>("select count(*)::int c from settlements");
    expect(n.rows[0].c).toBe(1);
    expect((await db.query<{ status: string }>("select status from otc_orders where hash=$1", [H("a")])).rows[0].status).toBe("filled");
    await expect(db.query("update settlements set fee_lamports=0")).rejects.toThrow(/immutable/);
    await expect(db.query("update otc_orders set status='open' where hash=$1", [H("a")])).rejects.toThrow(/final/);
    await expect(db.query("update otc_orders set lamports=1 where hash=$1", [H("a")])).rejects.toThrow(/immutable/);
    await expect(db.query("update settlement_sessions set buyer_signature='other' where id=$1", [sid])).rejects.toThrow();
  });

  it("posts a counter atomically and only once per parent", async () => {
    await insertOrder(orderRow(H("b")));
    const counter = orderRow(H("c"), { side: "buy", maker: "taker1", counterparty: "maker1", parent_hash: H("b"), root_hash: H("b") });
    await db.query("select otc_post_counter($1::jsonb)", [JSON.stringify(counter)]);
    expect((await db.query<{ status: string }>("select status from otc_orders where hash=$1", [H("b")])).rows[0].status).toBe("countered");
    const counter2 = orderRow(H("d"), { side: "buy", maker: "taker2", counterparty: "maker1", parent_hash: H("b"), root_hash: H("b") });
    await expect(db.query("select otc_post_counter($1::jsonb)", [JSON.stringify(counter2)])).rejects.toThrow(/not open/);
  });

  it("rejects duplicate maker nonces", async () => {
    await expect(insertOrder(orderRow(H("e"), { nonce: H("a").slice(0, 32) }))).rejects.toThrow(/duplicate/);
  });
});
