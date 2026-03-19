import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import type { TrendResponse } from '@/lib/types';

export function useTrend() {
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (did: string, window = '7d') => {
    if (!did) { setData(null); return; }
    setLoading(true);
    try {
      const res = await apiFetch(`/v1/memory/trend?did=${encodeURIComponent(did)}&window=${window}`);
      if (res.ok) setData(await res.json());
      else setData(null);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  return { trendData: data, trendLoading: loading, fetchTrend: fetch, clearTrend: () => setData(null) };
}
