import { useState, useEffect, useCallback } from 'react';
import { cpFetch } from '../lib/cpApi';

export interface Client {
  id: string;
  name: string;
  industry: string | null;
  entity_id: string | null;
  quickbooks_connected: boolean;
  xero_connected: boolean;
  agent_count: number;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PaginatedClients {
  clients: Client[];
  total: number;
  page: number;
  per_page: number;
}

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    try {
      const resp = await cpFetch('/v1/clients?per_page=50');
      if (resp.ok) {
        const data: PaginatedClients = await resp.json();
        setClients(data.clients);
        setTotal(data.total);
        setError(null);
      } else {
        const body = await resp.json().catch(() => ({}));
        setError(body.error || `Failed (${resp.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const createClient = useCallback(async (name: string, industry?: string): Promise<{ ok: boolean; error?: string; client?: Client }> => {
    try {
      const resp = await cpFetch('/v1/clients', {
        method: 'POST',
        body: JSON.stringify({ name, industry: industry || null }),
      });
      const data = await resp.json();
      if (resp.ok) {
        await fetchClients();
        return { ok: true, client: data };
      }
      return { ok: false, error: data.error || `Failed (${resp.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, [fetchClients]);

  const deleteClient = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await cpFetch(`/v1/clients/${id}`, { method: 'DELETE' });
      if (resp.ok || resp.status === 204) {
        await fetchClients();
        return { ok: true };
      }
      const data = await resp.json().catch(() => ({}));
      return { ok: false, error: data.error || `Failed (${resp.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, [fetchClients]);

  return { clients, total, loading, error, refetch: fetchClients, createClient, deleteClient };
}
