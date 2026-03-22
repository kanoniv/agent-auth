import {
  LayoutDashboard,
  Users,
  Waypoints,
  Shield,
  Globe,
  ShieldCheck,
} from 'lucide-react';

export const GOLD = '#C5A572';

export const DEFAULT_SCOPES = [
  'read', 'write', 'execute', 'delegate', 'admin',
];

export const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
  { label: 'No expiry', value: 0 },
];

/** Dot colors for provenance timeline (ProvenancePage) */
export const ACTION_DOT_COLORS: Record<string, string> = {
  register: 'bg-emerald-400',
  delegate: 'bg-[#C5A572]',
  revoke: 'bg-red-400',
  resolve: 'bg-blue-400',
  merge: 'bg-purple-400',
  mutate: 'bg-amber-400',
};

/** Badge colors for action labels (ActivityFeed, ProvenancePage) */
export const ACTION_BADGE_COLORS: Record<string, string> = {
  register: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  delegate: 'bg-[#C5A572]/10 text-[#C5A572] border-[#C5A572]/20',
  revoke: 'bg-red-500/10 text-red-400 border-red-500/20',
  resolve: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  merge: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  mutate: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { id: 'agents', label: 'Agents', icon: Users, path: '/agents' },
  { id: 'graph', label: 'Trust Graph', icon: Waypoints, path: '/graph' },
  { id: 'provenance', label: 'Provenance', icon: Shield, path: '/provenance' },
  { id: 'interop', label: 'Interop', icon: Globe, path: '/interop' },
  { id: 'verify', label: 'Verify', icon: ShieldCheck, path: '/verify' },
] as const;
