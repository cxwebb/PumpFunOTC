"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

interface Result<T> {
  path: string;
  data: T | null;
  error: string | null;
}

/** Fetch JSON from the app API, with optional polling. A null path disables fetching. */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [result, setResult] = useState<Result<T> | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api<T>(path);
      setResult({ path, data, error: null });
    } catch (e) {
      setResult((prev) => ({ path, data: prev?.path === path ? prev.data : null, error: (e as Error).message }));
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let active = true;
    const run = () => active && load();
    run();
    if (!opts.pollMs) return () => void (active = false);
    const id = setInterval(run, opts.pollMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [path, opts.pollMs, load]);

  const current = result && result.path === path ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !!path && !current, reload: load };
}

/** Current time, refreshed on an interval, for render-safe expiry checks. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
