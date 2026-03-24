import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X, Clock, DollarSign, Building2, Shield, ChevronDown } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { GOLD } from '../lib/constants';

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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  denied: 'bg-red-500/10 text-red-400 border-red-500/20',
  expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

function confidenceBadge(confidence: number | null) {
  if (confidence === null) return null;
  const pct = (confidence * 100).toFixed(0);
  const color = confidence >= 0.85 ? 'text-emerald-400' : confidence >= 0.5 ? 'text-amber-400' : 'text-red-400';
  return (
    <span className={`text-xs font-mono ${color}`}>
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
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
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
      if (resp.ok) {
        const data = await resp.json();
        setEscalations(data);
      }
    } catch { /* ignore */ }
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
      if (resp.ok) {
        fetchEscalations();
      }
    } catch { /* ignore */ }
    setActing(null);
  };

  const handleDeny = async (id: string) => {
    setActing(id);
    try {
      const resp = await apiFetch(`/v1/escalations/${id}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Denied by reviewer' }),
      });
      if (resp.ok) {
        fetchEscalations();
      }
    } catch { /* ignore */ }
    setActing(null);
  };

  const pendingCount = escalations.filter(e => e.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#E8E8ED]">Escalations</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {pendingCount > 0 ? `${pendingCount} pending approval` : 'No pending escalations'}
          </p>
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {['all', 'pending', 'approved', 'denied', 'expired'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                filter === f
                  ? 'border-[#C5A572]/50 bg-[#C5A572]/10 text-[#C5A572]'
                  : 'border-white/[.07] text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Escalation List */}
      {loading ? (
        <div className="text-zinc-500 text-sm">Loading...</div>
      ) : escalations.length === 0 ? (
        <div className="rounded-xl bg-[#12121a] border border-white/[.07] p-12 text-center">
          <AlertTriangle className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500">No escalations found</p>
          <p className="text-zinc-600 text-xs mt-1">
            Escalations appear when agents hit delegation limits
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {escalations.map((esc, i) => (
              <motion.div
                key={esc.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`rounded-xl bg-[#12121a] border border-white/[.07] overflow-hidden ${
                  esc.status === 'pending' ? 'border-amber-500/20' : ''
                }`}
              >
                {/* Card Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-white/[.02] transition-colors"
                  onClick={() => setExpandedId(expandedId === esc.id ? null : esc.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        esc.status === 'pending' ? 'bg-amber-400 animate-pulse' :
                        esc.status === 'approved' ? 'bg-emerald-400' :
                        esc.status === 'denied' ? 'bg-red-400' : 'bg-zinc-600'
                      }`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#E8E8ED]">
                            {esc.vendor || 'Unknown vendor'}
                          </span>
                          {esc.amount && (
                            <span className="text-sm font-mono" style={{ color: GOLD }}>
                              ${esc.amount.toLocaleString()}
                            </span>
                          )}
                          {confidenceBadge(esc.vendor_confidence)}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {esc.agent_name} - {esc.reason}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 text-xs rounded-md border ${STATUS_STYLES[esc.status]}`}>
                        {esc.status}
                      </span>
                      {esc.status === 'pending' && (
                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeUntilExpiry(esc.expires_at)}
                        </span>
                      )}
                      <span className="text-xs text-zinc-600">{timeAgo(esc.created_at)}</span>
                      <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${
                        expandedId === esc.id ? 'rotate-180' : ''
                      }`} />
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedId === esc.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/[.07]"
                  >
                    <div className="p-4 space-y-3">
                      {/* Detail Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <div className="text-xs text-zinc-500 flex items-center gap-1">
                            <Shield className="w-3 h-3" /> Agent
                          </div>
                          <div className="text-sm text-[#E8E8ED]">{esc.agent_name}</div>
                          <div className="text-xs text-zinc-600 font-mono truncate">{esc.agent_did}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-zinc-500 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> Amount
                          </div>
                          <div className="text-sm font-mono" style={{ color: GOLD }}>
                            {esc.amount ? `$${esc.amount.toLocaleString()}` : 'N/A'}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-zinc-500 flex items-center gap-1">
                            <Building2 className="w-3 h-3" /> Vendor
                          </div>
                          <div className="text-sm text-[#E8E8ED]">{esc.vendor || 'Unknown'}</div>
                          {confidenceBadge(esc.vendor_confidence)}
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-zinc-500">Action</div>
                          <div className="text-sm text-[#E8E8ED] font-mono text-xs">{esc.action}</div>
                        </div>
                      </div>

                      {/* Reason */}
                      <div className="rounded-lg bg-[#0a0a0f] p-3">
                        <div className="text-xs text-zinc-500 mb-1">Reason</div>
                        <div className="text-sm text-amber-400">{esc.reason}</div>
                      </div>

                      {/* Invoice Data */}
                      {esc.invoice_data && (
                        <div className="rounded-lg bg-[#0a0a0f] p-3">
                          <div className="text-xs text-zinc-500 mb-1">Invoice Data</div>
                          <pre className="text-xs text-zinc-400 font-mono overflow-x-auto">
                            {JSON.stringify(esc.invoice_data, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Resolution Info */}
                      {esc.status !== 'pending' && (
                        <div className="rounded-lg bg-[#0a0a0f] p-3">
                          <div className="text-xs text-zinc-500 mb-1">Resolution</div>
                          <div className="text-sm text-[#E8E8ED]">
                            {esc.status === 'approved' && `Approved by ${esc.approved_by}`}
                            {esc.status === 'denied' && `Denied by ${esc.approved_by}: ${esc.denial_reason}`}
                            {esc.status === 'expired' && 'Expired without action'}
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      {esc.status === 'pending' && (
                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={() => handleApprove(esc.id)}
                            disabled={acting === esc.id}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleDeny(esc.id)}
                            disabled={acting === esc.id}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                            Deny
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
