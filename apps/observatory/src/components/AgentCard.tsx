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
        'relative flex items-center gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors border',
        selected
          ? 'bg-[#FAF6ED] border-[#E8DCC4]'
          : 'border-transparent hover:bg-[#F7F6F3]',
      )}
    >
      {selected && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#B08D3E] rounded-r" />
      )}
      <ReputationBadge score={score} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#1A1814]">{agent.name}</span>
          <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(agent.status))} />
        </div>
        {agent.description && (
          <div className="text-[10px] text-[#9C978E] mt-0.5 truncate">{agent.description}</div>
        )}
        {agent.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {agent.capabilities.slice(0, 4).map(cap => (
              <span key={cap} className="text-[9px] px-1.5 py-0.5 rounded bg-[#FAFAF8] text-[#6B6760] border border-[#F0EDE6]">
                {cap}
              </span>
            ))}
            {agent.capabilities.length > 4 && (
              <span className="text-[9px] text-[#9C978E]">+{agent.capabilities.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
