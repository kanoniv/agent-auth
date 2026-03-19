import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { isDemoMode, DEMO_OUTCOMES, DEMO_MEMORIES, DEMO_TASKS } from '@/lib/demo-data';
import type { MemoryEntry, TaskEntry, OutcomeEntry } from '@/lib/types';

export function useMemory(pollInterval = 30000) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (isDemoMode()) {
      setMemories(DEMO_MEMORIES);
      setTasks(DEMO_TASKS);
      setOutcomes(DEMO_OUTCOMES);
      setLoading(false);
      return;
    }
    try {
      const f = (path: string) => apiFetch(path).catch(() => null);
      const [memRes, taskRes, outRes] = await Promise.all([
        f('/v1/memory?limit=200'),
        f('/v1/memory?entry_type=task&status=active&limit=30'),
        f('/v1/memory?entry_type=outcome&limit=50'),
      ]);
      if (memRes?.ok) {
        const data = await memRes.json();
        setMemories(Array.isArray(data) ? data : data.entries ?? []);
      }
      if (taskRes?.ok) {
        const data = await taskRes.json();
        setTasks(Array.isArray(data) ? data : data.entries ?? []);
      }
      if (outRes?.ok) {
        const data = await outRes.json();
        setOutcomes(Array.isArray(data) ? data : data.entries ?? []);
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

  return { memories, tasks, outcomes, loading, refetch: fetch };
}
