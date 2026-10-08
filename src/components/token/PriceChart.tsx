"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { api } from "@/client/api";
import type { Candle } from "@/modules/market-data/types";
import { Notice } from "../ui";

const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export function PriceChart({ pool }: { pool: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [tf, setTf] = useState<(typeof TFS)[number]>("5m");
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!el.current || !pool) return;
    const c = createChart(el.current, {
      height: 320,
      layout: { background: { type: ColorType.Solid, color: "#0d1214" }, textColor: "#7c8d95", fontFamily: "ui-monospace, monospace" },
      grid: { vertLines: { color: "#151d20" }, horzLines: { color: "#151d20" } },
      timeScale: { timeVisible: true, borderColor: "#1d272b" },
      rightPriceScale: { borderColor: "#1d272b" },
      autoSize: true,
    });
    chart.current = c;
    const series = c.addSeries(CandlestickSeries, {
      upColor: "#3ef08a",
      downColor: "#ff5c6c",
      borderVisible: false,
      wickUpColor: "#3ef08a",
      wickDownColor: "#ff5c6c",
      priceFormat: { type: "price", precision: 10, minMove: 1e-10 },
    });
    let cancelled = false;
    api<{ candles: Candle[] }>(`/api/market/candles?pool=${pool}&tf=${tf}`)
      .then(({ candles }) => {
        if (cancelled) return;
        setError(null);
        setEmpty(candles.length === 0);
        series.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
        c.timeScale().fitContent();
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      c.remove();
      chart.current = null;
    };
  }, [pool, tf]);

  if (!pool) return <Notice tone="warn">No market pair found, so there is no price chart for this token.</Notice>;
  return (
    <div>
      <div className="flex gap-1 mb-2">
        {TFS.map((t) => (
          <button key={t} className={`px-2 py-0.5 rounded text-xs ${t === tf ? "bg-panel-2" : "text-dim"}`} onClick={() => setTf(t)}>
            {t}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-dim">USD · GeckoTerminal · mainnet</span>
      </div>
      {error && <Notice tone="warn">Chart unavailable: {error}</Notice>}
      {empty && !error && <Notice tone="info">No candles for this timeframe yet.</Notice>}
      <div ref={el} className="w-full" />
    </div>
  );
}
