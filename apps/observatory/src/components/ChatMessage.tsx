import React from 'react';
import { User, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallCard } from './ToolCallCard';
import type { ChatMessage as ChatMessageType } from '@/lib/types';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div className={cn('flex gap-3 mb-4', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
        isUser ? 'bg-[#C5A572]/20' : 'bg-white/[.05]',
      )}>
        {isUser ? (
          <User className="w-3.5 h-3.5 text-[#C5A572]" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </div>
      <div className={cn('max-w-[80%] space-y-2', isUser && 'items-end')}>
        <div className={cn(
          'rounded-xl px-4 py-2.5 text-xs leading-relaxed',
          isUser
            ? 'bg-[#C5A572]/10 text-zinc-200 border border-[#C5A572]/20'
            : 'bg-[#12121a] text-zinc-300 border border-white/[.07]',
        )}>
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>

        {/* Tool calls */}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="space-y-1.5">
            {message.tool_calls.map(tc => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
