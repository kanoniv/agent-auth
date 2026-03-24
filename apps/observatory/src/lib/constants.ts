import {
  LayoutDashboard,
  Users,
  Waypoints,
  Shield,
  ShieldCheck,
  Wrench,
  AlertTriangle,
} from 'lucide-react';

export const GOLD = '#C5A572';

export const DEFAULT_SCOPES = [
  'read', 'write', 'execute', 'delegate', 'admin',
];

export const DELEGATION_TEMPLATES = [
  { label: 'Custom', scopes: [], maxCost: undefined, description: 'Configure manually' },
  { label: 'AP Clerk', scopes: ['accounting.read', 'accounting.write.create_bill', 'accounting.write.create_vendor'], maxCost: 5000, description: 'Routine invoices up to $5K' },
  { label: 'AP Manager', scopes: ['accounting.read', 'accounting.write'], maxCost: 25000, description: 'Most invoices up to $25K' },
  { label: 'Controller', scopes: ['accounting'], maxCost: 100000, description: 'Full accounting up to $100K' },
  { label: 'Bookkeeper', scopes: ['accounting.read', 'accounting.write.categorize'], maxCost: 0, description: 'Read + categorize only, no payments' },
  { label: 'Tax Preparer', scopes: ['accounting.read'], maxCost: 0, description: 'Read-only access for tax prep' },
] as const;

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
  // MCP tool calls use tool: prefix
  'tool:search_customers': 'bg-emerald-400',
  'tool:search_invoices': 'bg-emerald-400',
  'tool:search_vendors': 'bg-emerald-400',
  'tool:search_bills': 'bg-emerald-400',
  'tool:delete_bill': 'bg-red-400',
  'tool:delete_customer': 'bg-red-400',
  'tool:delete_vendor': 'bg-red-400',
  'tool:create_invoice': 'bg-blue-400',
  'tool:create_journal_entry': 'bg-amber-400',
  'tool:create_employee': 'bg-amber-400',
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
  { id: 'tools', label: 'Tools', icon: Wrench, path: '/tools' },
  { id: 'escalations', label: 'Escalations', icon: AlertTriangle, path: '/escalations' },
  { id: 'graph', label: 'Trust Graph', icon: Waypoints, path: '/graph' },
  { id: 'provenance', label: 'Provenance', icon: Shield, path: '/provenance' },
  { id: 'verify', label: 'Verify', icon: ShieldCheck, path: '/verify' },
] as const;
