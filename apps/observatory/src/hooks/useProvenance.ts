import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { isDemoMode, DEMO_PROVENANCE } from '@/lib/demo-data';
import type { ProvenanceEntry } from '@/lib/types';

export function useProvenance(limit = 50, pollInterval = 30000) {
  const [provenance, setProvenance] = useState<ProvenanceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (isDemoMode()) {
      setProvenance(DEMO_PROVENANCE.slice(0, limit));
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch(`/v1/provenance?limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        setProvenance(Array.isArray(data) ? data : data.entries ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [limit]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await fetch(); };
    run();
    const id = setInterval(run, pollInterval);
    return () => { cancelled = true; clearInterval(id); };
  }, [fetch, pollInterval]);

  return { provenance, loading, refetch: fetch };
}
