import { describe, it, expect } from 'vitest';
import { cn, shortId, shortDid, timeAgo, statusColor, statusDot, scoreColor, scoreFill } from './utils';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('returns empty string for no truthy values', () => {
    expect(cn(false, null, undefined)).toBe('');
  });

  it('handles single class', () => {
    expect(cn('only')).toBe('only');
  });

  it('handles empty call', () => {
    expect(cn()).toBe('');
  });
});

describe('shortId', () => {
  it('truncates long IDs to 8 chars', () => {
    expect(shortId('abcdefghijklmnop')).toBe('abcdefgh');
  });

  it('returns short IDs unchanged', () => {
    expect(shortId('abcdefgh')).toBe('abcdefgh');
    expect(shortId('abc')).toBe('abc');
  });

  it('handles empty string', () => {
    expect(shortId('')).toBe('');
  });
});

describe('shortDid', () => {
  it('abbreviates standard DIDs', () => {
    const result = shortDid('did:agent:coord-9f3a1b');
    expect(result).toBe('did:..coord-9f');
  });

  it('truncates non-DID strings to 16 chars', () => {
    expect(shortDid('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
  });

  it('returns dash for empty/falsy input', () => {
    expect(shortDid('')).toBe('-');
  });

  it('handles two-part DID', () => {
    // Less than 3 parts, falls to slice(0, 16)
    expect(shortDid('did:something')).toBe('did:something');
  });
});

describe('timeAgo', () => {
  it('returns seconds for very recent', () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toMatch(/^\d+s ago$/);
  });

  it('returns minutes', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(twoDaysAgo)).toBe('2d ago');
  });
});

describe('statusColor', () => {
  it('returns emerald for online', () => {
    expect(statusColor('online')).toBe('text-emerald-400');
  });

  it('returns amber for idle', () => {
    expect(statusColor('idle')).toBe('text-amber-400');
  });

  it('returns zinc-500 for offline', () => {
    expect(statusColor('offline')).toBe('text-zinc-500');
  });

  it('returns zinc-400 for unknown status', () => {
    expect(statusColor('unknown')).toBe('text-zinc-400');
  });
});

describe('statusDot', () => {
  it('returns emerald for online', () => {
    expect(statusDot('online')).toBe('bg-emerald-400');
  });

  it('returns amber for idle', () => {
    expect(statusDot('idle')).toBe('bg-amber-400');
  });

  it('returns zinc for offline', () => {
    expect(statusDot('offline')).toBe('bg-zinc-600');
  });

  it('returns zinc for unknown', () => {
    expect(statusDot('anything')).toBe('bg-zinc-600');
  });
});

describe('scoreColor', () => {
  it('returns emerald for high scores (>= 80)', () => {
    expect(scoreColor(80)).toBe('text-emerald-400');
    expect(scoreColor(100)).toBe('text-emerald-400');
  });

  it('returns amber for medium scores (60-79)', () => {
    expect(scoreColor(60)).toBe('text-amber-400');
    expect(scoreColor(79)).toBe('text-amber-400');
  });

  it('returns orange for low scores (40-59)', () => {
    expect(scoreColor(40)).toBe('text-orange-400');
    expect(scoreColor(59)).toBe('text-orange-400');
  });

  it('returns red for very low scores (< 40)', () => {
    expect(scoreColor(39)).toBe('text-red-400');
    expect(scoreColor(0)).toBe('text-red-400');
  });
});

describe('scoreFill', () => {
  it('returns correct hex colors for each tier', () => {
    expect(scoreFill(85)).toBe('#34d399');
    expect(scoreFill(65)).toBe('#fbbf24');
    expect(scoreFill(45)).toBe('#fb923c');
    expect(scoreFill(20)).toBe('#f87171');
  });

  it('handles boundary values', () => {
    expect(scoreFill(80)).toBe('#34d399');
    expect(scoreFill(60)).toBe('#fbbf24');
    expect(scoreFill(40)).toBe('#fb923c');
    expect(scoreFill(39)).toBe('#f87171');
  });
});
