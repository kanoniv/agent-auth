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
        <div className="w-6 h-6 border-2 border-[#B08D3E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-[#6B6760] text-sm">Agent not found</p>
        <a href="/agents" className="text-xs text-[#B08D3E] hover:text-[#C5A572] transition-colors">
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
          className="flex items-center gap-1.5 text-xs text-[#6B6760] hover:text-[#1A1814] transition-colors mb-6">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to agents
        </button>

        {/* Header */}
        <div className="flex items-start gap-5 mb-8">
          <ReputationBadge score={score} size="lg" />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold font-display text-[#1A1814]">{agent.name}</h1>
              <span className={cn('w-2.5 h-2.5 rounded-full', statusDot(agent.status))} />
              <span className={cn('text-sm', statusColor(agent.status))}>{agent.status}</span>
            </div>
            {agent.description && <p className="text-sm text-[#6B6760] mb-2">{agent.description}</p>}
            {agent.did && (
              <p className="text-xs font-mono text-[#9C978E] flex items-center gap-1.5">
                <Fingerprint className="w-3 h-3" />
                {agent.did}
              </p>
            )}
            {agent.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {agent.capabilities.map(cap => (
                  <span key={cap} className="text-[10px] px-2 py-1 rounded-md bg-[#FAFAF8] text-[#6B6760] border border-[#F0EDE6]">{cap}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Reputation breakdown */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-5 mb-6">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-4">Reputation Breakdown</h2>
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
                <span className="text-xs text-[#6B6760] w-24">{b.label}</span>
                <div className="flex-1 h-2 bg-[#F7F6F3] rounded-full overflow-hidden">
                  <div className="h-full bg-[#B08D3E] rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
                </div>
                <span className="text-xs text-[#6B6760] w-10 text-right font-data">{Math.round(b.value)}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Learning Curve */}
      {recallData && recallData.summary.total_outcomes > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-[#B08D3E]" />
              <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Learning Curve</h2>
            </div>
            <div className="flex gap-1">
              {['24h', '7d', '30d'].map(w => (
                <button key={w} onClick={() => setTrendWindow(w)}
                  className={cn('text-[10px] px-2 py-1 rounded',
                    trendWindow === w ? 'bg-[#FAF6ED] text-[#B08D3E]' : 'text-[#9C978E] hover:text-[#6B6760]'
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
              { label: 'Success Rate', value: recallData.summary.success_rate !== null ? `${(recallData.summary.success_rate * 100).toFixed(0)}%` : '-', color: 'text-[#1A7A42]' },
              { label: 'Avg Reward', value: recallData.summary.avg_reward !== null ? recallData.summary.avg_reward.toFixed(2) : '-', color: 'text-[#B08D3E]' },
              { label: 'Total Outcomes', value: String(recallData.summary.total_outcomes), color: 'text-[#1A1814]' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3 text-center">
                <div className={cn('text-lg font-bold font-mono font-data', s.color)}>{s.value}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Delegations */}
      {agentDelegations.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="mb-6">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-3">Delegations ({agentDelegations.length})</h2>
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
          <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-3">Provenance Timeline ({agentProvenance.length})</h2>
          <div className="space-y-1.5">
            {agentProvenance.slice(0, 20).map(p => (
              <div key={p.id} className="flex items-center gap-2 bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] px-3 py-2">
                <span className="text-[10px] text-[#B08D3E] min-w-[60px]">{p.action}</span>
                <span className="text-[9px] font-mono text-[#9C978E] flex-1 truncate">
                  {p.entity_ids.map(id => shortId(id)).join(', ')}
                </span>
                <span className="text-[9px] text-[#9C978E] shrink-0">{timeAgo(p.created_at)}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};
