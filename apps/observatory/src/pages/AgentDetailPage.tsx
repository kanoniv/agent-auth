import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Fingerprint, BarChart3 } from 'lucide-react';
import { useAgents } from '@/hooks/useAgents';
import { useDelegations } from '@/hooks/useDelegations';
import { useProvenance } from '@/hooks/useProvenance';
import { useRecall } from '@/hooks/useRecall';
import { useTrend } from '@/hooks/useTrend';
import { ReputationBadge } from '@/components/ReputationBadge';
import { DelegationCard } from '@/components/DelegationCard';
import { LearningCurve } from '@/components/LearningCurve';
import { RLLoopDiagram } from '@/components/RLLoopDiagram';
import { cn, statusDot, statusColor, shortDid, timeAgo, shortId, scoreColor } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

export const AgentDetailPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { agents, loading } = useAgents();
  const { delegations, refetch: refetchDelegations } = useDelegations();
  const { provenance } = useProvenance();
  const { recallData, fetchRecall } = useRecall();
  const { trendData, fetchTrend } = useTrend();
  const [trendWindow, setTrendWindow] = useState('7d');

  const agent = agents.find(a => a.name === name);
  const did = agent?.did ?? null;

  useEffect(() => {
    if (did) {
      fetchRecall(did);
      fetchTrend(did, trendWindow);
    }
  }, [did, trendWindow]);

  if (loading && !agent) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#C5A572] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-zinc-500 text-sm">Agent not found</p>
        <a href="/agents" className="text-xs text-[#C5A572] hover:text-[#D4BC94] transition-colors">
          Back to agents
        </a>
      </div>
    );
  }

  const score = agent.reputation?.composite_score ?? 50;
  const agentDelegations = delegations.filter(d => d.agent_name === name || d.grantor_name === name);
  const agentProvenance = provenance.filter(p => p.agent_name === name);

  const handleRevoke = async (id: string) => {
    await apiFetch(`/v1/delegations/${id}`, { method: 'DELETE' });
    refetchDelegations();
  };

  const handleRemoveScope = async (id: string, scopes: string[], scope: string) => {
    const newScopes = scopes.filter(s => s !== scope);
    if (newScopes.length === 0) return handleRevoke(id);
    await apiFetch(`/v1/delegations/${id}`, { method: 'PUT', body: JSON.stringify({ scopes: newScopes }) });
    refetchDelegations();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <button onClick={() => navigate('/agents')}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-6">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to agents
        </button>

        {/* Header */}
        <div className="flex items-start gap-5 mb-8">
          <ReputationBadge score={score} size="lg" />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-[#E8E8ED]">{agent.name}</h1>
              <span className={cn('w-2.5 h-2.5 rounded-full', statusDot(agent.status))} />
              <span className={cn('text-sm', statusColor(agent.status))}>{agent.status}</span>
            </div>
            {agent.description && <p className="text-sm text-zinc-500 mb-2">{agent.description}</p>}
            {agent.did && (
              <p className="text-xs font-mono text-zinc-600 flex items-center gap-1.5">
                <Fingerprint className="w-3 h-3" />
                {agent.did}
              </p>
            )}
            {agent.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {agent.capabilities.map(cap => (
                  <span key={cap} className="text-[10px] px-2 py-1 rounded-md bg-white/[.04] text-zinc-400 border border-white/[.06]">{cap}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Reputation breakdown */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="rounded-xl bg-[#12121a] border border-white/[.07] p-5 mb-6">
        <h2 className="text-xs font-semibold text-zinc-400 mb-4">Reputation Breakdown</h2>
        {agent.reputation && (
          <div className="space-y-3">
            {[
              { label: 'Activity', value: Math.min(100, Math.log2((agent.reputation.total_actions || 0) + 1) * 15) },
              { label: 'Success Rate', value: (agent.reputation.success_rate ?? 1) * 100 },
              { label: 'Feedback', value: ((agent.reputation.feedback_score ?? 0) + 1) / 2 * 100 },
              { label: 'Tenure', value: Math.min(100, ((agent.reputation.tenure_days ?? 0) / 90) * 100) },
              { label: 'Diversity', value: Math.min(100, ((agent.reputation.action_diversity ?? 0) / 7) * 100) },
            ].map(b => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 w-24">{b.label}</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-[#C5A572] rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
                </div>
                <span className="text-xs text-zinc-400 w-10 text-right">{Math.round(b.value)}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Learning Curve */}
      {recallData && recallData.summary.total_outcomes > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-xl bg-[#12121a] border border-white/[.07] p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-[#C5A572]" />
              <h2 className="text-xs font-semibold text-zinc-400">Learning Curve</h2>
            </div>
            <div className="flex gap-1">
              {['24h', '7d', '30d'].map(w => (
                <button key={w} onClick={() => setTrendWindow(w)}
                  className={cn('text-[10px] px-2 py-1 rounded',
                    trendWindow === w ? 'bg-[#C5A572]/15 text-[#C5A572]' : 'text-zinc-600 hover:text-zinc-400'
                  )}>{w}</button>
              ))}
            </div>
          </div>
          <div className="mb-3">
            <RLLoopDiagram trend={recallData.summary.recent_trend} />
          </div>
          {trendData && trendData.points.length > 1 && (
            <LearningCurve points={trendData.points} height={160} />
          )}
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: 'Success Rate', value: recallData.summary.success_rate !== null ? `${(recallData.summary.success_rate * 100).toFixed(0)}%` : '-', color: 'text-emerald-400' },
              { label: 'Avg Reward', value: recallData.summary.avg_reward !== null ? recallData.summary.avg_reward.toFixed(2) : '-', color: 'text-[#C5A572]' },
              { label: 'Total Outcomes', value: String(recallData.summary.total_outcomes), color: 'text-zinc-300' },
            ].map(s => (
              <div key={s.label} className="rounded-lg bg-[#0a0a0f] border border-white/[.07] p-3 text-center">
                <div className={cn('text-lg font-bold font-mono', s.color)}>{s.value}</div>
                <div className="text-[9px] text-zinc-600 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Delegations */}
      {agentDelegations.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="mb-6">
          <h2 className="text-xs font-semibold text-zinc-400 mb-3">Delegations ({agentDelegations.length})</h2>
          <div className="space-y-2">
            {agentDelegations.map(d => (
              <DelegationCard key={d.id} delegation={d} onRevoke={handleRevoke} onRemoveScope={handleRemoveScope} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Provenance */}
      {agentProvenance.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 className="text-xs font-semibold text-zinc-400 mb-3">Provenance Timeline ({agentProvenance.length})</h2>
          <div className="space-y-1.5">
            {agentProvenance.slice(0, 20).map(p => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg bg-[#12121a] border border-white/[.07] px-3 py-2">
                <span className="text-[10px] text-[#C5A572] min-w-[60px]">{p.action}</span>
                <span className="text-[9px] font-mono text-zinc-600 flex-1 truncate">
                  {p.entity_ids.map(id => shortId(id)).join(', ')}
                </span>
                <span className="text-[9px] text-zinc-600 shrink-0">{timeAgo(p.created_at)}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};
