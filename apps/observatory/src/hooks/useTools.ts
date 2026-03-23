import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

export interface Tool {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  category: string;
  risk_level: string | null;
  risk_action: string | null;
  risk_consequences: string[] | null;
  risk_compliance: string[] | null;
  risk_remediation: string[] | null;
  call_count: number;
  deny_count: number;
  last_seen_at: string;
}

export function useTools() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/v1/tools')
      .then(r => r.json())
      .then(data => { if (!cancelled) setTools(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const byCategory = {
    read: tools.filter(t => t.category === 'read'),
    write: tools.filter(t => t.category === 'write'),
    delete: tools.filter(t => t.category === 'delete'),
    unknown: tools.filter(t => !['read', 'write', 'delete'].includes(t.category)),
  };

  return { tools, byCategory, loading };
}
