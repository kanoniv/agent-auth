import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { cn, timeAgo, shortId } from '@/lib/utils';
import { ACTION_BADGE_COLORS } from '@/lib/constants';
import type { ProvenanceEntry } from '@/lib/types';

interface ActivityFeedProps {
  entries: ProvenanceEntry[];
  limit?: number;
}

const actionColor = ACTION_BADGE_COLORS;

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ entries, limit = 10 }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = entries.slice(0, limit);

  return (
    <div className="space-y-1.5">
      {items.map((entry, i) => {
        const isExp = expanded === entry.id;
        const colors = actionColor[entry.action] || 'bg-[#F7F6F3] text-[#6B6760] border-[#E8E5DE]';
        return (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={cn(
              'rounded-md bg-white border cursor-pointer transition-colors',
              isExp ? 'border-[#E8DCC4] shadow-[0_1px_2px_rgba(26,24,20,0.04)]' : 'border-[#E8E5DE] hover:border-[#E8DCC4]',
            )}
            onClick={() => setExpanded(isExp ? null : entry.id)}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="text-xs font-medium text-[#1A1814] min-w-[80px]">{entry.agent_name}</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', colors)}>
                {entry.action}
              </span>
              {entry.entity_ids.length > 0 && (
                <span className="text-[10px] font-mono text-[#9C978E] truncate flex-1">
                  {entry.entity_ids.map(id => shortId(id)).join(', ')}
                </span>
              )}
              <span className="text-[10px] text-[#9C978E] shrink-0">{timeAgo(entry.created_at)}</span>
            </div>
            {isExp && Object.keys(entry.metadata).length > 0 && (
              <div className="px-3 pb-2.5 border-t border-[#F0EDE6]">
                <pre className="text-[9px] text-[#6B6760] mt-2 overflow-x-auto font-mono">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
};
