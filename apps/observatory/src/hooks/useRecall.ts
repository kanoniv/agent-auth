import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import type { RecallResponse } from '@/lib/types';

export function useRecall() {
  const [data, setData] = useState<RecallResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (did: string) => {
    if (!did) { setData(null); return; }
    setLoading(true);
    try {
      const res = await apiFetch(`/v1/memory/recall?did=${encodeURIComponent(did)}&entry_type=outcome`);
      if (res.ok) setData(await res.json());
      else setData(null);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  return { recallData: data, recallLoading: loading, fetchRecall: fetch, clearRecall: () => setData(null) };
}
