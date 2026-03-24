import { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, FileCheck, Shield, Calendar, Hash, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { GOLD } from '../lib/constants';

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
      const data = await resp.json();
      setPkg(data);
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[#E8E8ED]">Audit Export</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Export a signed audit package for compliance review
        </p>
      </div>

      {/* Date Range + Export */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl bg-[#12121a] border border-white/[.07] p-6"
      >
        <div className="flex items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> From
            </label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> To
            </label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/50"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg border transition-colors disabled:opacity-50"
            style={{ borderColor: `${GOLD}50`, background: `${GOLD}15`, color: GOLD }}
          >
            <FileCheck className="w-4 h-4" />
            {loading ? 'Generating...' : 'Generate Package'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}
      </motion.div>

      {/* Package Preview */}
      {pkg && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Actions', value: pkg.summary.total_actions, icon: Shield },
              { label: 'Escalations', value: pkg.summary.total_escalations, icon: AlertTriangle },
              { label: 'Agents', value: pkg.summary.unique_agents, icon: Shield },
              { label: 'Delegations', value: pkg.summary.active_delegations, icon: Shield },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl bg-[#12121a] border border-white/[.07] p-4">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                  <Icon className="w-3 h-3" /> {label}
                </div>
                <div className="text-2xl font-semibold" style={{ color: GOLD }}>
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* Verification Info */}
          <div className="rounded-xl bg-[#12121a] border border-white/[.07] p-6 space-y-3">
            <h3 className="text-sm font-medium text-[#E8E8ED] flex items-center gap-2">
              <Hash className="w-4 h-4" style={{ color: GOLD }} /> Verification
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Content Hash (SHA-256)</span>
                <span className="font-mono text-xs text-[#E8E8ED] select-all">{pkg.content_hash}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Generated</span>
                <span className="text-[#E8E8ED]">{new Date(pkg.generated_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Date Range</span>
                <span className="text-[#E8E8ED]">{pkg.date_range.from} to {pkg.date_range.to}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Package Version</span>
                <span className="text-[#E8E8ED]">{pkg.package_version}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-white/[.07]">
              <p className="text-xs text-zinc-500">
                To verify: compute SHA-256 of the entries, escalations, delegations, and summary
                fields. Compare against the content hash above. Any modification to the package
                content will produce a different hash.
              </p>
            </div>
          </div>

          {/* Escalation Breakdown */}
          {pkg.summary.total_escalations > 0 && (
            <div className="rounded-xl bg-[#12121a] border border-white/[.07] p-6">
              <h3 className="text-sm font-medium text-[#E8E8ED] mb-3">Escalation Breakdown</h3>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-zinc-400">Approved: {pkg.summary.escalations_approved}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-sm text-zinc-400">Denied: {pkg.summary.escalations_denied}</span>
                </div>
              </div>
            </div>
          )}

          {/* Download */}
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-5 py-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors w-full justify-center"
          >
            <Download className="w-5 h-5" />
            Download Audit Package ({(JSON.stringify(pkg).length / 1024).toFixed(1)} KB)
          </button>
        </motion.div>
      )}

      {/* Empty State */}
      {!pkg && !loading && !error && (
        <div className="rounded-xl bg-[#12121a] border border-white/[.07] p-12 text-center">
          <FileCheck className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500">Select a date range and generate an audit package</p>
          <p className="text-zinc-600 text-xs mt-1">
            Packages include all provenance entries, escalation decisions, and active delegations
          </p>
        </div>
      )}
    </div>
  );
};
