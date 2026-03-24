import { useState, useEffect, useCallback } from 'react';

const JWT_KEY = 'kanoniv-jwt';
const REFRESH_KEY = 'kanoniv-refresh';
const USER_KEY = 'kanoniv-user';

// CP API base URL for auth (separate from Observatory API)
const CP_API_URL = (typeof window !== 'undefined' && (window as any).__CP_API_URL) || 'https://control.kanoniv.com';

interface User {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  tenant_id?: string;
}

interface AuthState {
  jwt: string | null;
  user: User | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const jwt = localStorage.getItem(JWT_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    let user: User | null = null;
    try { if (userRaw) user = JSON.parse(userRaw); } catch { /* tampered localStorage */ }
    return { jwt, user, loading: false };
  });

  const isAuthenticated = !!state.jwt;

  const login = useCallback(async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    setState(s => ({ ...s, loading: true }));
    try {
      const resp = await fetch(`${CP_API_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setState(s => ({ ...s, loading: false }));
        return { ok: false, error: data.error || `Login failed (${resp.status})` };
      }
      const jwt = data.access_token || data.token;
      const refresh = data.refresh_token;
      if (jwt) localStorage.setItem(JWT_KEY, jwt);
      if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
      const user: User = { email, tenant_id: data.tenant_id };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setState({ jwt, user, loading: false });
      return { ok: true };
    } catch (e) {
      setState(s => ({ ...s, loading: false }));
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, []);

  const signup = useCallback(async (
    email: string, password: string, first_name: string, last_name: string, company: string
  ): Promise<{ ok: boolean; error?: string }> => {
    setState(s => ({ ...s, loading: true }));
    try {
      const resp = await fetch(`${CP_API_URL}/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, first_name, last_name, company }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setState(s => ({ ...s, loading: false }));
        return { ok: false, error: data.error || `Signup failed (${resp.status})` };
      }
      const jwt = data.access_token || data.token;
      const refresh = data.refresh_token;
      if (jwt) localStorage.setItem(JWT_KEY, jwt);
      if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
      const user: User = { email, first_name, last_name, company, tenant_id: data.tenant_id };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setState({ jwt, user, loading: false });
      return { ok: true };
    } catch (e) {
      setState(s => ({ ...s, loading: false }));
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ jwt: null, user: null, loading: false });
  }, []);

  // Auto-refresh on 401 (future)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === JWT_KEY && !e.newValue) {
        setState({ jwt: null, user: null, loading: false });
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return { ...state, isAuthenticated, login, signup, logout, cpApiUrl: CP_API_URL };
}
