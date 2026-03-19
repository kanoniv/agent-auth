import { useState, useCallback, useEffect } from 'react';
import { getConnection } from '@/lib/api';
import { isDemoMode, setDemoMode } from '@/lib/demo-data';

export function useConnection() {
  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoModeState] = useState(isDemoMode());

  const check = useCallback(async () => {
    try {
      const conn = getConnection();
      const base = conn.apiUrl || '';
      const headers: Record<string, string> = {};
      if (conn.apiKey) headers['X-API-Key'] = conn.apiKey;
      const res = await fetch(`${base}/health`, { headers });
      setConnected(res.ok);
    } catch {
      setConnected(false);
    }
  }, []);

  const enableDemoMode = useCallback(() => {
    setDemoMode(true);
    setDemoModeState(true);
  }, []);

  const disableDemoMode = useCallback(() => {
    setDemoMode(false);
    setDemoModeState(false);
  }, []);

  useEffect(() => { check(); }, [check]);

  return { connected, demoMode, check, enableDemoMode, disableDemoMode };
}
