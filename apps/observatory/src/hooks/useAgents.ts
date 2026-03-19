import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import type { AgentRecord } from '@/lib/types';
import { isDemoMode, DEMO_AGENTS } from '@/lib/demo-data';

export function useAgents(pollInterval = 30000) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (isDemoMode()) {
      setAgents(DEMO_AGENTS);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch('/v1/agents');
      if (res.ok) {
        setAgents(await res.json());
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await fetch();
    };
    run();
    const id = setInterval(run, pollInterval);
    return () => { cancelled = true; clearInterval(id); };
  }, [fetch, pollInterval]);

  return { agents, loading, error, refetch: fetch };
}
