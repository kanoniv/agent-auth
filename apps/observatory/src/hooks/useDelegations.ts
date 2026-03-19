import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { isDemoMode, DEMO_DELEGATIONS } from '@/lib/demo-data';
import type { Delegation } from '@/lib/types';

export function useDelegations(pollInterval = 30000) {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (isDemoMode()) {
      setDelegations(DEMO_DELEGATIONS);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch('/v1/delegations');
      if (res.ok) {
        const data = await res.json();
        setDelegations(Array.isArray(data) ? data : data.delegations ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await fetch(); };
    run();
    const id = setInterval(run, pollInterval);
    return () => { cancelled = true; clearInterval(id); };
  }, [fetch, pollInterval]);

  return { delegations, loading, refetch: fetch };
}
