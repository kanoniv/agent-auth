import type { ConnectionConfig } from './types';

export const STORAGE_KEY = 'agent-trust-connection';

export function getConnection(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { apiUrl: '', apiKey: '', agentName: '' };
}

export function saveConnection(config: ConnectionConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage full or unavailable - silently ignore
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const conn = getConnection();
  const base = conn.apiUrl || '';
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (conn.apiKey) headers['X-API-Key'] = conn.apiKey;
  if (!headers['X-Agent-Name']) headers['X-Agent-Name'] = conn.agentName || 'observatory';
  return fetch(`${base}${path}`, { ...options, headers });
}
