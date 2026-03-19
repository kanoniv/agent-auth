import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val; },
  removeItem: (key: string) => { delete store[key]; },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
import { getConnection, saveConnection, apiFetch, STORAGE_KEY } from './api';

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  mockFetch.mockReset();
});

describe('getConnection', () => {
  it('returns defaults when nothing stored', () => {
    const conn = getConnection();
    expect(conn.apiUrl).toBe('');
    expect(conn.apiKey).toBe('');
    expect(conn.agentName).toBe('');
  });

  it('returns stored config', () => {
    store[STORAGE_KEY] = JSON.stringify({ apiUrl: 'http://test:4100', apiKey: 'key123', agentName: 'myagent' });
    const conn = getConnection();
    expect(conn.apiUrl).toBe('http://test:4100');
    expect(conn.apiKey).toBe('key123');
    expect(conn.agentName).toBe('myagent');
  });

  it('handles corrupted localStorage gracefully', () => {
    store[STORAGE_KEY] = 'not-json';
    const conn = getConnection();
    expect(conn.apiUrl).toBe('');
  });
});

describe('saveConnection', () => {
  it('persists config to localStorage', () => {
    saveConnection({ apiUrl: 'http://localhost:4100', apiKey: '', agentName: 'test' });
    const raw = JSON.parse(store[STORAGE_KEY]);
    expect(raw.apiUrl).toBe('http://localhost:4100');
    expect(raw.agentName).toBe('test');
  });
});

describe('apiFetch', () => {
  it('sets Content-Type for requests with body', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents', { method: 'POST', body: JSON.stringify({ name: 'test' }) });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('does not set Content-Type for GET requests', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('sets X-Agent-Name to default observatory', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-Agent-Name']).toBe('observatory');
  });

  it('uses stored agent name', async () => {
    store[STORAGE_KEY] = JSON.stringify({ apiUrl: '', apiKey: '', agentName: 'custom-agent' });
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-Agent-Name']).toBe('custom-agent');
  });

  it('preserves caller-provided X-Agent-Name header (does not overwrite)', async () => {
    store[STORAGE_KEY] = JSON.stringify({ apiUrl: '', apiKey: '', agentName: 'observatory' });
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/delegations', {
      method: 'POST',
      headers: { 'X-Agent-Name': 'coordinator' },
      body: JSON.stringify({ agent_name: 'researcher', scopes: ['read'] }),
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-Agent-Name']).toBe('coordinator');
  });

  it('sets X-API-Key when configured', async () => {
    store[STORAGE_KEY] = JSON.stringify({ apiUrl: '', apiKey: 'secret-key', agentName: '' });
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-API-Key']).toBe('secret-key');
  });

  it('does not set X-API-Key when empty', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-API-Key']).toBeUndefined();
  });

  it('prepends base URL from config', async () => {
    store[STORAGE_KEY] = JSON.stringify({ apiUrl: 'http://myapi:4100', apiKey: '', agentName: '' });
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://myapi:4100/v1/agents');
  });

  it('works with empty base URL (proxy mode)', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    await apiFetch('/v1/agents');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/v1/agents');
  });
});
