export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable - silently ignore
  }
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function shortDid(did: string): string {
  if (!did) return '-';
  const parts = did.split(':');
  if (parts.length >= 3) return `did:..${parts[parts.length - 1].slice(0, 8)}`;
  return did.slice(0, 16);
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'online': return 'text-emerald-400';
    case 'idle': return 'text-amber-400';
    case 'offline': return 'text-zinc-500';
    default: return 'text-zinc-400';
  }
}

export function statusDot(status: string): string {
  switch (status) {
    case 'online': return 'bg-[#1A7A42]';
    case 'idle': return 'bg-[#B8860B]';
    case 'offline': return 'bg-[#9C978E]';
    default: return 'bg-[#9C978E]';
  }
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'text-[#1A7A42]';
  if (score >= 60) return 'text-[#B8860B]';
  if (score >= 40) return 'text-[#B8860B]';
  return 'text-[#C23A3A]';
}

export function scoreFill(score: number): string {
  if (score >= 80) return '#34d399';
  if (score >= 60) return '#fbbf24';
  if (score >= 40) return '#fb923c';
  return '#f87171';
}
