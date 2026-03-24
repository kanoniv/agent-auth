import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X, Clock, DollarSign, Building2, Shield, ChevronDown, CheckCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useClients } from '../hooks/useClients';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const } },
};

interface Escalation {
  id: string;
  agent_did: string;
  agent_name: string;
  action: string;
  amount: number | null;
  vendor: string | null;
  vendor_confidence: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  invoice_data: Record<string, unknown> | null;
  approved_by: string | null;
  denial_reason: string | null;
  approval_token: string | null;
  client_id: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-[#FFF8E8] text-[#B8860B] border-[#F0DDB0]',
  approved: 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]',
  denied: 'bg-[#FDF0F0] text-[#C23A3A] border-[#F0C6C6]',
  expired: 'bg-[#F7F6F3] text-[#9C978E] border-[#E8E5DE]',
};

const ACCENT_BORDER: Record<string, string> = {
  pending: 'border-l-[#B8860B]',
  approved: 'border-l-[#1A7A42]',
  denied: 'border-l-[#C23A3A]',
  expired: 'border-l-[#9C978E]',
};

function confidenceBadge(confidence: number | null) {
  if (confidence === null) return null;
  const pct = (confidence * 100).toFixed(0);
  const style = confidence >= 0.85
    ? 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]'
    : confidence >= 0.5
    ? 'bg-[#FFF8E8] text-[#B8860B] border-[#F0DDB0]'
    : 'bg-[#FDF0F0] text-[#C23A3A] border-[#F0C6C6]';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${style}`}>
      {pct}% match
    </span>
  );
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeUntilExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export const EscalationsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { clients } = useClients();
  const clientMap = new Map(clients.map(c => [c.id, c.name]));

  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>(searchParams.get('client_id') || 'all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const fetchEscalations = useCallback(async () => {
    try {
      const qp = new URLSearchParams();
      if (filter !== 'all') qp.set('status', filter);
      if (clientFilter !== 'all') qp.set('client_id', clientFilter);
      const qs = qp.toString();
      const resp = await apiFetch(`/v1/escalations${qs ? `?${qs}` : ''}`);
      if (resp.ok) setEscalations(await resp.json());
    } catch { /* degrade silently */ }
    setLoading(false);
  }, [filter, clientFilter]);

  useEffect(() => {
    fetchEscalations();
    const interval = setInterval(fetchEscalations, 10000);
    return () => clearInterval(interval);
  }, [fetchEscalations]);

  const handleApprove = async (id: string) => {
    setActing(id);
    try {
      const resp = await apiFetch(`/v1/escalations/${id}/approve`, { method: 'POST' });
      if (resp.ok) fetchEscalations();
    } catch { /* */ }
    setActing(null);
  };

  const handleDeny = async (id: string) => {
    setActing(id);
    try {
      await apiFetch(`/v1/escalations/${id}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Denied by reviewer' }),
      });
      fetchEscalations();
    } catch { /* */ }
    setActing(null);
  };

  const pendingCount = escalations.filter(e => e.status === 'pending').length;

  return (
    <motion.div className="p-6 max-w-5xl mx-auto" initial="hidden" animate="show" variants={stagger}>
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Authorization</p>
          <h1 className="text-2xl font-display text-[#1A1814]">Escalations</h1>
          <p className="text-xs text-[#6B6760] mt-1">
            {pendingCount > 0
              ? `${pendingCount} pending approval${pendingCount > 1 ? 's' : ''}`
              : 'No pending escalations'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Client filter */}
          {clients.length > 0 && (
            <select
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
              className="bg-white border border-[#E8E5DE] text-[#6B6760] text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#B08D3E] transition-colors"
            >
              <option value="all">All Clients</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Status filters */}
          <div className="flex gap-1.5">
            {['all', 'pending', 'approved', 'denied', 'expired'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  filter === f
                    ? 'bg-[#FAF6ED] text-[#B08D3E] border border-[#E8DCC4]'
                    : 'bg-white border border-[#E8E5DE] text-[#6B6760] hover:bg-[#F7F6F3]'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-lg bg-white border border-[#E8E5DE] animate-pulse" />
          ))}
        </div>
      ) : escalations.length === 0 ? (
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-3 text-center py-16">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
            <CheckCircle className="w-10 h-10 text-[#1A7A42]" />
          </motion.div>
          <p className="text-sm font-medium text-[#1A1814]">All clear</p>
          <p className="text-xs text-[#9C978E]">Escalations appear when agents exceed delegation limits</p>
        </motion.div>
      ) : (
        <motion.div variants={stagger} className="space-y-3">
          <AnimatePresence>
            {escalations.map(esc => (
              <motion.div
                key={esc.id}
                variants={fadeUp}
                className={`bg-white border border-[#E8E5DE] border-l-2 ${ACCENT_BORDER[esc.status]} rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] overflow-hidden`}
              >
                {/* Card Header */}
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-[#F7F6F3] transition-colors"
                  onClick={() => setExpandedId(expandedId === esc.id ? null : esc.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#1A1814] truncate">
                            {esc.vendor || 'Unknown vendor'}
                          </span>
                          {esc.amount != null && (
                            <span className="text-sm font-bold font-data tabular-nums text-[#B08D3E]">
                              ${esc.amount.toLocaleString()}
                            </span>
                          )}
                          {confidenceBadge(esc.vendor_confidence)}
                        </div>
                        <p className="text-xs text-[#6B6760] mt-0.5 truncate">
                          {esc.agent_name}
                          {esc.client_id && clientMap.get(esc.client_id) && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#F7F6F3] text-[#9C978E] border border-[#F0EDE6]">
                              {clientMap.get(esc.client_id)}
                            </span>
                          )}
                          <span className="mx-1 text-[#E8E5DE]">-</span>{esc.reason}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] border ${STATUS_BADGE[esc.status]}`}>
                        {esc.status}
                      </span>
                      {esc.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#6B6760] tabular-nums">
                          <Clock className="w-3 h-3" />
                          {timeUntilExpiry(esc.expires_at)}
                        </span>
                      )}
                      <span className="text-[10px] text-[#9C978E] tabular-nums">{timeAgo(esc.created_at)}</span>
                      <ChevronDown className={`w-4 h-4 text-[#9C978E] transition-transform duration-200 ${
                        expandedId === esc.id ? 'rotate-180' : ''
                      }`} />
                    </div>
                  </div>
                </div>

                {/* Expanded */}
                {expandedId === esc.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-[#E8E5DE]"
                  >
                    <div className="px-5 py-4 space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          { label: 'Agent', icon: Shield, value: esc.agent_name, sub: esc.agent_did },
                          { label: 'Amount', icon: DollarSign, value: esc.amount ? `$${esc.amount.toLocaleString()}` : 'N/A', sub: null },
                          { label: 'Vendor', icon: Building2, value: esc.vendor || 'Unknown', sub: null },
                          { label: 'Action', icon: Shield, value: esc.action, sub: null },
                        ].map(({ label, icon: Icon, value, sub }) => (
                          <div key={label}>
                            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] flex items-center gap-1 mb-1">
                              <Icon className="w-3 h-3" /> {label}
                            </p>
                            <p className={`text-sm text-[#1A1814] ${label === 'Amount' ? 'font-bold font-data tabular-nums text-[#B08D3E]' : ''} ${label === 'Action' ? 'font-mono text-xs' : ''}`}>
                              {value}
                            </p>
                            {sub && <p className="text-[10px] text-[#9C978E] font-mono truncate mt-0.5">{sub}</p>}
                          </div>
                        ))}
                      </div>

                      <div className="bg-[#FAFAF8] rounded-lg p-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Reason</p>
                        <p className="text-sm text-[#B8860B]">{esc.reason}</p>
                      </div>

                      {esc.invoice_data && (
                        <div className="bg-[#FAFAF8] rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Invoice</p>
                          <pre className="text-xs text-[#6B6760] font-mono overflow-x-auto">
                            {JSON.stringify(esc.invoice_data, null, 2)}
                          </pre>
                        </div>
                      )}

                      {esc.status !== 'pending' && (
                        <div className="bg-[#FAFAF8] rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Resolution</p>
                          <p className="text-sm text-[#1A1814]">
                            {esc.status === 'approved' && `Approved by ${esc.approved_by}`}
                            {esc.status === 'denied' && `Denied: ${esc.denial_reason}`}
                            {esc.status === 'expired' && 'Expired without action'}
                          </p>
                        </div>
                      )}

                      {esc.status === 'pending' && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleApprove(esc.id)}
                            disabled={acting === esc.id}
                            className="bg-[#1A7A42] hover:bg-[#1A7A42]/90 text-white font-bold text-sm rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            <Check className="w-4 h-4" /> Approve
                          </button>
                          <button
                            onClick={() => handleDeny(esc.id)}
                            disabled={acting === esc.id}
                            className="bg-[#FDF0F0] border border-[#F0C6C6] text-[#C23A3A] hover:bg-[#C23A3A]/10 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            <X className="w-4 h-4" /> Deny
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </motion.div>
  );
};
