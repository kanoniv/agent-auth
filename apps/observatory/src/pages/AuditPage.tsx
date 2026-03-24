import { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, FileCheck, Shield, Calendar, Hash, AlertTriangle, Users, Waypoints } from 'lucide-react';
import { apiFetch } from '../lib/api';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const } },
};

interface AuditPackage {
  package_version: string;
  generated_at: string;
  date_range: { from: string; to: string };
  entries: unknown[];
  escalations: unknown[];
  delegations: unknown[];
  summary: {
    total_actions: number;
    total_escalations: number;
    escalations_approved: number;
    escalations_denied: number;
    unique_agents: number;
    active_delegations: number;
  };
  content_hash: string;
}

export const AuditPage: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(false);
  const [pkg, setPkg] = useState<AuditPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    setPkg(null);
    try {
      const resp = await apiFetch(`/v1/audit/export?from=${from}&to=${to}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error || `HTTP ${resp.status}`);
        return;
      }
      setPkg(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-package-${from}-to-${to}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div className="p-6 max-w-5xl mx-auto" initial="hidden" animate="show" variants={stagger}>
      {/* Header */}
      <motion.div variants={fadeUp} className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Compliance</p>
        <h1 className="text-2xl font-bold text-[#E8E8ED]">Audit Export</h1>
        <p className="text-xs text-[#8B8B96] mt-1">Generate a verifiable audit package for any date range</p>
      </motion.div>

      {/* Controls */}
      <motion.div variants={fadeUp} className="bg-[#12121a] border border-white/[.07] rounded-xl p-5 mb-6">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] flex items-center gap-1 mb-1.5">
              <Calendar className="w-3 h-3" /> From
            </label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2.5 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/40 transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] flex items-center gap-1 mb-1.5">
              <Calendar className="w-3 h-3" /> To
            </label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2.5 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/40 transition-colors"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={loading}
            className="bg-[#C5A572] hover:bg-[#D4BC94] text-[#0a0a0f] font-bold text-sm rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <FileCheck className="w-4 h-4" />
            {loading ? 'Generating...' : 'Generate Package'}
          </button>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-[#F87171] flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </motion.div>
        )}
      </motion.div>

      {/* Package Result */}
      {pkg ? (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
          {/* Summary Stats */}
          <motion.div variants={fadeUp} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Actions', value: pkg.summary.total_actions, icon: Shield },
              { label: 'Escalations', value: pkg.summary.total_escalations, icon: AlertTriangle },
              { label: 'Agents', value: pkg.summary.unique_agents, icon: Users },
              { label: 'Delegations', value: pkg.summary.active_delegations, icon: Waypoints },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-[#12121a] border border-white/[.07] rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] flex items-center gap-1 mb-2">
                  <Icon className="w-3 h-3" /> {label}
                </p>
                <p className="text-2xl font-bold tabular-nums text-[#C5A572]">
                  {value.toLocaleString()}
                </p>
              </div>
            ))}
          </motion.div>

          {/* Verification */}
          <motion.div variants={fadeUp} className="bg-[#12121a] border border-white/[.07] rounded-xl p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] flex items-center gap-1.5 mb-4">
              <Hash className="w-3 h-3 text-[#C5A572]" /> Verification
            </p>
            <div className="space-y-2.5">
              {[
                ['Content Hash', <span className="font-mono text-xs select-all">{pkg.content_hash}</span>],
                ['Generated', new Date(pkg.generated_at).toLocaleString()],
                ['Date Range', `${pkg.date_range.from} to ${pkg.date_range.to}`],
                ['Package Version', pkg.package_version],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between items-center">
                  <span className="text-xs text-[#8B8B96]">{label}</span>
                  <span className="text-sm text-[#E8E8ED]">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-white/[.03]">
              <p className="text-[10px] text-[#55555F] leading-relaxed">
                To verify: compute SHA-256 of the entries, escalations, delegations, and summary
                fields. Compare against the content hash above. Any modification produces a different hash.
              </p>
            </div>
          </motion.div>

          {/* Escalation Breakdown */}
          {pkg.summary.total_escalations > 0 && (
            <motion.div variants={fadeUp} className="bg-[#12121a] border border-white/[.07] rounded-xl p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-3">Escalation Breakdown</p>
              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#34D399]" />
                  <span className="text-sm text-[#8B8B96]">Approved</span>
                  <span className="text-sm font-bold tabular-nums text-[#E8E8ED]">{pkg.summary.escalations_approved}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#F87171]" />
                  <span className="text-sm text-[#8B8B96]">Denied</span>
                  <span className="text-sm font-bold tabular-nums text-[#E8E8ED]">{pkg.summary.escalations_denied}</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Download */}
          <motion.div variants={fadeUp}>
            <button
              onClick={handleDownload}
              className="w-full bg-[#C5A572] hover:bg-[#D4BC94] text-[#0a0a0f] font-bold text-sm rounded-lg px-4 py-3 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" />
              Download Audit Package ({(JSON.stringify(pkg).length / 1024).toFixed(1)} KB)
            </button>
          </motion.div>
        </motion.div>
      ) : !loading && !error ? (
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-3 text-center py-16">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
            <FileCheck className="w-10 h-10 text-[#C5A572]" />
          </motion.div>
          <p className="text-sm font-medium text-[#E8E8ED]">Select a date range to export</p>
          <p className="text-xs text-[#55555F] max-w-sm">
            Packages include all provenance entries, escalation decisions, and active delegations with SHA-256 content verification
          </p>
        </motion.div>
      ) : null}
    </motion.div>
  );
};
