import React, { useState } from 'react';
import { ChevronRight, Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCall } from '@/lib/types';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 className="w-3 h-3 text-[#B08D3E] animate-spin" />,
    success: <CheckCircle2 className="w-3 h-3 text-[#1A7A42]" />,
    error: <XCircle className="w-3 h-3 text-[#C23A3A]" />,
  }[toolCall.status];

  return (
    <div className="rounded-lg bg-[#FAFAF8] border border-[#E8E5DE] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F7F6F3] transition-colors"
      >
        <Wrench className="w-3 h-3 text-[#9C978E]" />
        <span className="text-[10px] font-mono text-[#B08D3E]">{toolCall.name}</span>
        {statusIcon}
        <ChevronRight className={cn(
          'w-3 h-3 text-[#9C978E] ml-auto transition-transform',
          expanded && 'rotate-90',
        )} />
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 border-t border-[#F0EDE6] space-y-2">
          {Object.keys(toolCall.args).length > 0 && (
            <div>
              <div className="text-[8px] text-[#9C978E] uppercase tracking-wider mt-2 mb-1">Arguments</div>
              <pre className="text-[9px] text-[#6B6760] bg-white rounded p-2 overflow-x-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div>
              <div className="text-[8px] text-[#9C978E] uppercase tracking-wider mb-1">Result</div>
              <pre className="text-[9px] text-[#6B6760] bg-white rounded p-2 overflow-x-auto max-h-40">
                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
