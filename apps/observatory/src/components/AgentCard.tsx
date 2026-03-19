import React from 'react';
import { cn, statusDot } from '@/lib/utils';
import { ReputationBadge } from './ReputationBadge';
import type { AgentRecord } from '@/lib/types';

interface AgentCardProps {
  agent: AgentRecord;
  selected?: boolean;
  onClick?: () => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, selected, onClick }) => {
  const score = agent.reputation?.composite_score ?? 50;

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border',
        selected
          ? 'bg-[#C5A572]/5 border-[#C5A572]/30'
          : 'border-transparent hover:bg-white/[.03]',
      )}
    >
      {selected && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#C5A572] rounded-r" />
      )}
      <ReputationBadge score={score} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#E8E8ED]">{agent.name}</span>
          <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(agent.status))} />
        </div>
        {agent.description && (
          <div className="text-[10px] text-zinc-600 mt-0.5 truncate">{agent.description}</div>
        )}
        {agent.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {agent.capabilities.slice(0, 4).map(cap => (
              <span key={cap} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[.04] text-zinc-500 border border-white/[.06]">
                {cap}
              </span>
            ))}
            {agent.capabilities.length > 4 && (
              <span className="text-[9px] text-zinc-600">+{agent.capabilities.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
