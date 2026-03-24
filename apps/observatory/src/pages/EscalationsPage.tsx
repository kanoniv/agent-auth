import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X, Clock, DollarSign, Building2, Shield, ChevronDown, CheckCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';

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
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  approved: 'bg-green-500/15 text-green-400 border-green-500/20',
  denied: 'bg-red-500/15 text-red-400 border-red-500/20',
  expired: 'bg-white/[.05] text-[#55555F] border-white/[.07]',
};

const ACCENT_BORDER: Record<string, string> = {
  pending: 'border-l-amber-400',
  approved: 'border-l-[#34D399]',
  denied: 'border-l-[#F87171]',
  expired: 'border-l-[#55555F]',
};

function confidenceBadge(confidence: number | null) {
  if (confidence === null) return null;
  const pct = (confidence * 100).toFixed(0);
  const style = confidence >= 0.85
    ? 'bg-green-500/15 text-green-400 border-green-500/20'
    : confidence >= 0.5
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    : 'bg-red-500/15 text-red-400 border-red-500/20';
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
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const fetchEscalations = useCallback(async () => {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const resp = await apiFetch(`/v1/escalations${params}`);
      if (resp.ok) setEscalations(await resp.json());
    } catch { /* degrade silently */ }
    setLoading(false);
  }, [filter]);

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
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Authorization</p>
          <h1 className="text-2xl font-bold text-[#E8E8ED]">Escalations</h1>
          <p className="text-xs text-[#8B8B96] mt-1">
            {pendingCount > 0
              ? `${pendingCount} pending approval${pendingCount > 1 ? 's' : ''}`
              : 'No pending escalations'}
          </p>
        </div>

        <div className="flex gap-1.5">
          {['all', 'pending', 'approved', 'denied', 'expired'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                filter === f
                  ? 'bg-[#C5A572]/10 text-[#C5A572] border border-[#C5A572]/20'
                  : 'bg-white/[.02] border border-white/[.07] text-[#8B8B96] hover:text-[#E8E8ED] hover:bg-white/[.05]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </motion.div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-xl bg-[#12121a] border border-white/[.07] animate-pulse" />
          ))}
        </div>
      ) : escalations.length === 0 ? (
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-3 text-center py-16">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
            <CheckCircle className="w-10 h-10 text-[#34D399]" />
          </motion.div>
          <p className="text-sm font-medium text-[#E8E8ED]">All clear</p>
          <p className="text-xs text-[#55555F]">Escalations appear when agents exceed delegation limits</p>
        </motion.div>
      ) : (
        <motion.div variants={stagger} className="space-y-3">
          <AnimatePresence>
            {escalations.map(esc => (
              <motion.div
                key={esc.id}
                variants={fadeUp}
                className={`bg-[#12121a] border border-white/[.07] border-l-2 ${ACCENT_BORDER[esc.status]} rounded-lg overflow-hidden`}
              >
                {/* Card Header */}
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-white/[.02] transition-colors"
                  onClick={() => setExpandedId(expandedId === esc.id ? null : esc.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#E8E8ED] truncate">
                            {esc.vendor || 'Unknown vendor'}
                          </span>
                          {esc.amount != null && (
                            <span className="text-sm font-bold tabular-nums text-[#C5A572]">
                              ${esc.amount.toLocaleString()}
                            </span>
                          )}
                          {confidenceBadge(esc.vendor_confidence)}
                        </div>
                        <p className="text-xs text-[#55555F] mt-0.5 truncate">{esc.agent_name} - {esc.reason}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${STATUS_BADGE[esc.status]}`}>
                        {esc.status}
                      </span>
                      {esc.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#8B8B96] tabular-nums">
                          <Clock className="w-3 h-3" />
                          {timeUntilExpiry(esc.expires_at)}
                        </span>
                      )}
                      <span className="text-[10px] text-[#55555F] tabular-nums">{timeAgo(esc.created_at)}</span>
                      <ChevronDown className={`w-4 h-4 text-[#55555F] transition-transform duration-200 ${
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
                    className="border-t border-white/[.07]"
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
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] flex items-center gap-1 mb-1">
                              <Icon className="w-3 h-3" /> {label}
                            </p>
                            <p className={`text-sm text-[#E8E8ED] ${label === 'Amount' ? 'font-bold tabular-nums text-[#C5A572]' : ''} ${label === 'Action' ? 'font-mono text-xs' : ''}`}>
                              {value}
                            </p>
                            {sub && <p className="text-[10px] text-[#55555F] font-mono truncate mt-0.5">{sub}</p>}
                          </div>
                        ))}
                      </div>

                      <div className="bg-[#0a0a0f] rounded-lg p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Reason</p>
                        <p className="text-sm text-amber-400">{esc.reason}</p>
                      </div>

                      {esc.invoice_data && (
                        <div className="bg-[#0a0a0f] rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Invoice</p>
                          <pre className="text-xs text-[#8B8B96] font-mono overflow-x-auto">
                            {JSON.stringify(esc.invoice_data, null, 2)}
                          </pre>
                        </div>
                      )}

                      {esc.status !== 'pending' && (
                        <div className="bg-[#0a0a0f] rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Resolution</p>
                          <p className="text-sm text-[#E8E8ED]">
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
                            className="bg-[#34D399] hover:bg-[#34D399]/80 text-[#0a0a0f] font-bold text-sm rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            <Check className="w-4 h-4" /> Approve
                          </button>
                          <button
                            onClick={() => handleDeny(esc.id)}
                            disabled={acting === esc.id}
                            className="border border-[#F87171]/20 bg-[#F87171]/10 text-[#F87171] hover:bg-[#F87171]/20 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 flex items-center gap-2"
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
