import { useState, useEffect, useCallback } from 'react';
import { cpFetch } from '../lib/cpApi';
import { apiFetch } from '../lib/api';

export interface ClientAgent {
  id: string;
  agent_name: string;
  agent_did: string | null;
  scopes: string[];
  ttl_hours: number;
  active: boolean;
  created_at: string;
}

export interface ClientDetail {
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
  agents: ClientAgent[];
}

export interface QbCompany {
  client_id: string;
  realm_id: string;
  company_name: string | null;
  legal_name: string | null;
  address: Record<string, unknown> | null;
  fiscal_year_start: string | null;
  industry_type: string | null;
  fetched_at: string;
}

export interface QbVendor {
  id: string;
  qb_vendor_id: string;
  display_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  balance: number | null;
  active: boolean;
  synced_at: string;
}

export interface Escalation {
  id: string;
  agent_did: string;
  agent_name: string;
  action: string;
  amount: number | null;
  vendor: string | null;
  vendor_confidence: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  client_id: string | null;
  created_at: string;
  expires_at: string;
}

export function useClientDetail(clientId: string | undefined) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [company, setCompany] = useState<QbCompany | null>(null);
  const [vendors, setVendors] = useState<QbVendor[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    try {
      // Fetch client detail from CP API
      const clientResp = await cpFetch(`/v1/clients/${clientId}`);
      if (cancelled) return;
      if (!clientResp.ok) {
        setError(`Failed to load client (${clientResp.status})`);
        setLoading(false);
        return;
      }
      const clientData: ClientDetail = await clientResp.json();
      if (cancelled) return;
      setClient(clientData);

      // Fetch QB data if connected (parallel, best-effort)
      const promises: Promise<void>[] = [];

      if (clientData.quickbooks_connected) {
        promises.push(
          cpFetch(`/v1/clients/${clientId}/qb/company`)
            .then(async (r) => { if (!cancelled && r.ok) setCompany(await r.json()); })
            .catch(() => {})
        );
        promises.push(
          cpFetch(`/v1/clients/${clientId}/qb/vendors`)
            .then(async (r) => { if (!cancelled && r.ok) setVendors(await r.json()); })
            .catch(() => {})
        );
      }

      // Fetch escalations for this client from Observatory API
      promises.push(
        apiFetch(`/v1/escalations?client_id=${clientId}&limit=10`)
          .then(async (r) => { if (!cancelled && r.ok) setEscalations(await r.json()); })
          .catch(() => {})
      );

      await Promise.all(promises);
    } catch (e) {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Network error');
    }
    if (!cancelled) setLoading(false);

    // Return cleanup for useEffect
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const assignAgent = useCallback(async (
    agentName: string, scopes: string[], ttlHours: number
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await cpFetch(`/v1/agents/${agentName}/assign`, {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, scopes, ttl_hours: ttlHours }),
      });
      if (resp.ok) {
        await fetchAll();
        return { ok: true };
      }
      const data = await resp.json().catch(() => ({}));
      return { ok: false, error: data.error || `Failed (${resp.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, [clientId, fetchAll]);

  const unassignAgent = useCallback(async (agentName: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await cpFetch(`/v1/agents/${agentName}/unassign`, {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId }),
      });
      if (resp.ok || resp.status === 204) {
        await fetchAll();
        return { ok: true };
      }
      const data = await resp.json().catch(() => ({}));
      return { ok: false, error: data.error || `Failed (${resp.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, [clientId, fetchAll]);

  const triggerImport = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await cpFetch(`/v1/clients/${clientId}/qb/import`, { method: 'POST' });
      if (resp.ok) {
        await fetchAll();
        return { ok: true };
      }
      const data = await resp.json().catch(() => ({}));
      return { ok: false, error: data.error || `Failed (${resp.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, [clientId, fetchAll]);

  return {
    client, company, vendors, escalations,
    loading, error,
    refetch: fetchAll, assignAgent, unassignAgent, triggerImport,
  };
}
