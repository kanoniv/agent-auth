import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  FileCheck,
  Building2,
  Settings,
} from 'lucide-react';

export const GOLD = '#B08D3E';
export const GOLD_HOVER = '#C5A572';

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
  register: 'bg-[#1A7A42]',
  delegate: 'bg-[#B08D3E]',
  revoke: 'bg-[#C23A3A]',
  resolve: 'bg-[#2E6DA4]',
  merge: 'bg-purple-600',
  mutate: 'bg-[#B8860B]',
  'tool:search_customers': 'bg-[#1A7A42]',
  'tool:search_invoices': 'bg-[#1A7A42]',
  'tool:search_vendors': 'bg-[#1A7A42]',
  'tool:search_bills': 'bg-[#1A7A42]',
  'tool:delete_bill': 'bg-[#C23A3A]',
  'tool:delete_customer': 'bg-[#C23A3A]',
  'tool:delete_vendor': 'bg-[#C23A3A]',
  'tool:create_invoice': 'bg-[#2E6DA4]',
  'tool:create_journal_entry': 'bg-[#B8860B]',
  'tool:create_employee': 'bg-[#B8860B]',
};

/** Badge colors for action labels (ActivityFeed, ProvenancePage) */
export const ACTION_BADGE_COLORS: Record<string, string> = {
  register: 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]',
  delegate: 'bg-[#FAF6ED] text-[#B08D3E] border-[#E8DCC4]',
  revoke: 'bg-[#FDF0F0] text-[#C23A3A] border-[#F0C6C6]',
  resolve: 'bg-[#EDF4FB] text-[#2E6DA4] border-[#B8D4F0]',
  merge: 'bg-purple-50 text-purple-700 border-purple-200',
  mutate: 'bg-[#FFF8E8] text-[#B8860B] border-[#F0DDB0]',
};

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/' },
  { id: 'clients', label: 'Clients', icon: Building2, path: '/clients' },
  { id: 'agents', label: 'Agents', icon: Users, path: '/agents' },
  { id: 'escalations', label: 'Escalations', icon: AlertTriangle, path: '/escalations' },
  { id: 'audit', label: 'Audit', icon: FileCheck, path: '/audit' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
] as const;
