import type { Order } from "@/modules/otc/orders/order";

export interface OrderRow {
  hash: string;
  payload: Order;
  signature: string;
  side: "sell" | "buy";
  maker: string;
  counterparty: string | null;
  mint: string;
  decimals: number;
  token_amount: string;
  lamports: string;
  fee_bps: number;
  parent_hash: string | null;
  root_hash: string;
  expires_at: string;
  status: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  order_hash: string;
  buyer: string;
  seller: string;
  taker: string;
  terms: Record<string, string | number>;
  message_b64: string;
  message_sha256: string;
  recent_blockhash: string;
  last_valid_block_height: number;
  cu_limit: number;
  cu_price_micro_lamports: number;
  buyer_signature: string | null;
  seller_signature: string | null;
  tx_signature: string | null;
  state: string;
  error: string | null;
  created_at: string;
}

export interface TradeRow {
  tx_signature: string;
  order_hash: string;
  buyer: string;
  seller: string;
  mint: string;
  token_amount: string;
  gross_lamports: string;
  fee_lamports: string;
  seller_net_lamports: string;
  created_at: string;
  block_time: string | null;
}
