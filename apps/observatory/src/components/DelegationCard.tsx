import React from 'react';
import { ArrowRight, Trash2, Clock } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import type { Delegation } from '@/lib/types';

interface DelegationCardProps {
  delegation: Delegation;
  onRevoke?: (id: string) => void;
  onRemoveScope?: (id: string, scopes: string[], scope: string) => void;
}

export const DelegationCard: React.FC<DelegationCardProps> = ({ delegation, onRevoke, onRemoveScope }) => {
  const expired = delegation.expires_at && new Date(delegation.expires_at) < new Date();

  return (
    <div className={cn(
      'rounded-lg bg-[#12121a] border border-white/[.07] px-3 py-2.5',
      expired && 'opacity-50',
    )}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[#E8E8ED]">{delegation.grantor_name}</span>
        <ArrowRight className="w-3 h-3 text-[#C5A572]" />
        <span className="text-xs font-medium text-[#E8E8ED]">{delegation.agent_name}</span>
        {delegation.expires_at && (
          <span className="flex items-center gap-1 text-[9px] text-zinc-600 ml-auto">
            <Clock className="w-3 h-3" />
            {expired ? 'expired' : timeAgo(delegation.expires_at).replace(' ago', '')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {delegation.scopes.map(scope => (
          <button
            key={scope}
            aria-label={`Remove scope: ${scope}`}
            onClick={e => { e.stopPropagation(); onRemoveScope?.(delegation.id, delegation.scopes, scope); }}
            className="text-[9px] px-1.5 py-0.5 rounded bg-[#C5A572]/10 text-[#C5A572] border border-[#C5A572]/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-colors"
          >
            {scope}
          </button>
        ))}
        {onRevoke && (
          <button
            aria-label={`Revoke delegation from ${delegation.grantor_name} to ${delegation.agent_name}`}
            onClick={e => { e.stopPropagation(); onRevoke(delegation.id); }}
            className="ml-auto p-1 rounded hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
