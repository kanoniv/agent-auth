import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Waypoints } from 'lucide-react';
import { useAgents } from '@/hooks/useAgents';
import { useDelegations } from '@/hooks/useDelegations';
import { TrustGraph } from '@/components/TrustGraph';
import { ReputationBadge } from '@/components/ReputationBadge';
import { cn, statusDot, statusColor, shortDid } from '@/lib/utils';
import type { AgentRecord } from '@/lib/types';

export const GraphPage: React.FC = () => {
  const navigate = useNavigate();
  const { agents, loading } = useAgents();
  const { delegations } = useDelegations();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const selected = agents.find(a => a.name === selectedAgent) ?? null;

  if (loading && agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#C5A572] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Graph area */}
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <Waypoints className="w-4 h-4 text-[#C5A572]" />
          <span className="text-sm font-bold text-[#E8E8ED]">Trust Graph</span>
        </div>

        <TrustGraph
          agents={agents}
          delegations={delegations}
          selectedId={selectedAgent}
          onSelect={setSelectedAgent}
          onDoubleClick={(name) => navigate(`/agents/${name}`)}
          fullscreen
        />

        {/* Legend */}
        <div className="absolute bottom-4 left-4 flex items-center gap-4 text-[9px] text-zinc-600 bg-[#12121a]/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/[.07]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" />Online</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />Idle</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-600" />Offline</span>
          <span className="flex items-center gap-1">
            <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#C5A572" strokeWidth="1.5" opacity="0.4" /></svg>
            Delegation
          </span>
        </div>
      </div>

      {/* Info overlay */}
      {selected && (
        <motion.div
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-72 border-l border-white/[.07] bg-[#12121a] p-4 overflow-y-auto"
        >
          <div className="flex items-center gap-3 mb-4">
            <ReputationBadge score={selected.reputation?.composite_score ?? 50} size="md" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-[#E8E8ED]">{selected.name}</span>
                <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(selected.status))} />
              </div>
              <span className={cn('text-[10px]', statusColor(selected.status))}>{selected.status}</span>
            </div>
          </div>

          {selected.description && (
            <p className="text-[10px] text-zinc-500 mb-3">{selected.description}</p>
          )}

          {selected.did && (
            <div className="text-[9px] font-mono text-zinc-600 mb-3 bg-[#0a0a0f] rounded px-2 py-1.5 border border-white/[.07]">
              {selected.did}
            </div>
          )}

          {selected.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {selected.capabilities.map(cap => (
                <span key={cap} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[.04] text-zinc-500 border border-white/[.06]">{cap}</span>
              ))}
            </div>
          )}

          {selected.reputation && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { label: 'Actions', value: selected.reputation.total_actions },
                { label: 'Success', value: `${(selected.reputation.success_rate * 100).toFixed(0)}%` },
                { label: 'Tenure', value: `${selected.reputation.tenure_days}d` },
                { label: 'Diversity', value: selected.reputation.action_diversity ?? 0 },
              ].map(s => (
                <div key={s.label} className="rounded bg-[#0a0a0f] border border-white/[.07] p-2 text-center">
                  <div className="text-xs font-bold text-[#E8E8ED]">{s.value}</div>
                  <div className="text-[8px] text-zinc-600">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => navigate(`/agents/${selected.name}`)}
            className="w-full text-xs py-2 rounded-lg border border-white/[.07] text-zinc-400 hover:text-[#C5A572] hover:border-[#C5A572]/30 transition-colors">
            View full profile
          </button>
        </motion.div>
      )}
    </div>
  );
};
