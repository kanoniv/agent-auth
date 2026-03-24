const JWT_KEY = 'kanoniv-jwt';
const CP_API_URL = (typeof window !== 'undefined' && (window as any).__CP_API_URL) || 'https://control.kanoniv.com';

export function cpFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const jwt = localStorage.getItem(JWT_KEY);
  return fetch(`${CP_API_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...opts.headers,
    },
  });
}

export { CP_API_URL };
