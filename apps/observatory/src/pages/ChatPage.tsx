import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  MessageCircle, Send, Terminal, Sparkles, Users, Shield, Link2, Activity,
} from 'lucide-react';
import { apiFetch, getConnection } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { useAgents } from '@/hooks/useAgents';
import { useDelegations } from '@/hooks/useDelegations';
import { useProvenance } from '@/hooks/useProvenance';
import { ChatMessage as ChatMessageComponent } from '@/components/ChatMessage';
import type { AgentRecord, ChatMessage, ToolCall } from '@/lib/types';

type Mode = 'command' | 'llm';

const HELP_TEXT = `Available commands:
  agents                     - List all registered agents
  register <name> [caps...]  - Register a new agent
  delegate <agent> <scopes>  - Grant delegation (scopes: read,write,execute,delegate,admin)
  revoke <agent>             - Revoke all delegations for an agent
  observe <agent> <action> <result> <reward> - Record an outcome
  recall <agent>             - Get agent's RL context
  help                       - Show this help message`;

function parseCommand(input: string): { cmd: string; args: string[] } | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 0) return null;
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

export const ChatPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('command');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { agents, refetch: refetchAgents } = useAgents();
  const { delegations, refetch: refetchDelegations } = useDelegations();
  const { provenance } = useProvenance();

  const conn = getConnection();
  const hasLlmKey = !!conn.llmApiKey;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const addMessage = (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, newMsg]);
    return newMsg;
  };

  const handleCommandMode = async (text: string) => {
    const parsed = parseCommand(text);
    if (!parsed) return;
    const { cmd, args } = parsed;

    let response = '';
    const toolCalls: ToolCall[] = [];

    try {
      switch (cmd) {
        case 'help': {
          response = HELP_TEXT;
          break;
        }
        case 'agents': {
          const tc: ToolCall = { id: crypto.randomUUID(), name: 'list_agents', args: {}, status: 'pending' };
          toolCalls.push(tc);
          const res = await apiFetch('/v1/agents');
          if (res.ok) {
            const data = await res.json();
            tc.result = data;
            tc.status = 'success';
            response = `${(data as AgentRecord[]).length} agent(s) registered:\n${(data as AgentRecord[]).map((a: AgentRecord) =>
              `  ${a.name} [${a.status}] score=${a.reputation?.composite_score ?? '?'}`
            ).join('\n')}`;
          } else {
            tc.status = 'error';
            tc.result = 'Failed to fetch agents';
            response = 'Failed to list agents.';
          }
          break;
        }
        case 'register': {
          if (args.length === 0) { response = 'Usage: register <name> [capabilities...]'; break; }
          const name = args[0];
          const caps = args.slice(1);
          const tc: ToolCall = { id: crypto.randomUUID(), name: 'register_agent', args: { name, capabilities: caps }, status: 'pending' };
          toolCalls.push(tc);
          const res = await apiFetch('/v1/agents/register', {
            method: 'POST',
            body: JSON.stringify({ name, capabilities: caps }),
          });
          if (res.ok) {
            const data = await res.json();
            tc.result = data;
            tc.status = 'success';
            response = `Registered agent "${name}" with capabilities: ${caps.join(', ') || 'none'}`;
            refetchAgents();
          } else {
            tc.status = 'error';
            tc.result = await res.text();
            response = 'Failed to register agent.';
          }
          break;
        }
        case 'delegate': {
          if (args.length < 2) { response = 'Usage: delegate <agent> <scope1> [scope2...]'; break; }
          const agentName = args[0];
          const scopes = args.slice(1);
          const tc: ToolCall = { id: crypto.randomUUID(), name: 'grant_delegation', args: { agent_name: agentName, scopes }, status: 'pending' };
          toolCalls.push(tc);
          const res = await apiFetch('/v1/delegations', {
            method: 'POST',
            body: JSON.stringify({ agent_name: agentName, scopes }),
          });
          if (res.ok) {
            const data = await res.json();
            tc.result = data;
            tc.status = 'success';
            response = `Delegated [${scopes.join(', ')}] to ${agentName}`;
            refetchDelegations();
          } else {
            tc.status = 'error';
            tc.result = await res.text();
            response = 'Failed to grant delegation.';
          }
          break;
        }
        case 'revoke': {
          if (args.length === 0) { response = 'Usage: revoke <agent>'; break; }
          const agentName = args[0];
          const tc: ToolCall = { id: crypto.randomUUID(), name: 'revoke_delegation', args: { agent_name: agentName }, status: 'pending' };
          toolCalls.push(tc);
          // Find and revoke all delegations for this agent
          const agentDels = delegations.filter(d => d.agent_name === agentName && !d.revoked_at);
          let revoked = 0;
          for (const d of agentDels) {
            const res = await apiFetch(`/v1/delegations/${d.id}`, { method: 'DELETE' });
            if (res.ok) revoked++;
          }
          tc.result = { revoked_count: revoked };
          tc.status = 'success';
          response = `Revoked ${revoked} delegation(s) for ${agentName}`;
          refetchDelegations();
          break;
        }
        case 'observe': {
          if (args.length < 4) { response = 'Usage: observe <agent> <action> <result> <reward>'; break; }
          const [agentName, action, result, rewardStr] = args;
          const reward = parseFloat(rewardStr);
          if (isNaN(reward) || reward < -1 || reward > 1) {
            response = 'Reward must be a number between -1 and 1';
            break;
          }
          // Look up the agent DID
          const agent = agents.find(a => a.name === agentName);
          if (!agent?.did) { response = `Agent "${agentName}" not found or has no DID`; break; }
          const tc: ToolCall = {
            id: crypto.randomUUID(), name: 'record_observation',
            args: { subject_did: agent.did, action, result, reward_signal: reward }, status: 'pending',
          };
          toolCalls.push(tc);
          const res = await apiFetch('/v1/memory/feedback', {
            method: 'POST',
            body: JSON.stringify({ subject_did: agent.did, action, result, reward_signal: reward }),
          });
          if (res.ok) {
            tc.result = await res.json();
            tc.status = 'success';
            response = `Recorded: ${agentName} ${action} -> ${result} (reward: ${reward})`;
          } else {
            tc.status = 'error';
            tc.result = await res.text();
            response = 'Failed to record observation.';
          }
          break;
        }
        case 'recall': {
          if (args.length === 0) { response = 'Usage: recall <agent>'; break; }
          const agentName = args[0];
          const agent = agents.find(a => a.name === agentName);
          if (!agent?.did) { response = `Agent "${agentName}" not found or has no DID`; break; }
          const tc: ToolCall = { id: crypto.randomUUID(), name: 'recall_agent', args: { did: agent.did }, status: 'pending' };
          toolCalls.push(tc);
          const res = await apiFetch(`/v1/memory/recall?did=${encodeURIComponent(agent.did)}&entry_type=outcome`);
          if (res.ok) {
            const data = await res.json();
            tc.result = data;
            tc.status = 'success';
            const s = data.summary;
            response = `Recall for ${agentName}:
  Total outcomes: ${s.total_outcomes}
  Success rate: ${s.success_rate !== null ? (s.success_rate * 100).toFixed(0) + '%' : 'n/a'}
  Avg reward: ${s.avg_reward !== null ? s.avg_reward.toFixed(2) : 'n/a'}
  Trend: ${s.recent_trend}
  Strong at: ${s.top_success_actions.join(', ') || 'n/a'}
  Weak at: ${s.top_failure_actions.join(', ') || 'n/a'}`;
          } else {
            tc.status = 'error';
            tc.result = await res.text();
            response = 'Failed to recall agent data.';
          }
          break;
        }
        default:
          response = `Unknown command: "${cmd}". Type "help" for available commands.`;
      }
    } catch (e) {
      response = `Error: ${e instanceof Error ? e.message : 'unknown error'}`;
    }

    addMessage({ role: 'assistant', content: response, tool_calls: toolCalls.length > 0 ? toolCalls : undefined });
  };

  const handleLlmMode = async (text: string) => {
    try {
      const res = await apiFetch('/v1/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          mode: 'llm',
        }),
      });

      if (!res.ok) {
        addMessage({ role: 'assistant', content: `Error: ${res.status} ${res.statusText}` });
        return;
      }

      const data = await res.json();
      if (data.conversation_id) setConversationId(data.conversation_id);

      const toolCalls: ToolCall[] = (data.tool_calls || []).map((tc: { id?: string; name: string; args?: Record<string, unknown>; result?: unknown; error?: unknown }) => ({
        id: tc.id || crypto.randomUUID(),
        name: tc.name,
        args: tc.args || {},
        result: tc.result,
        status: tc.error ? 'error' as const : 'success' as const,
      }));

      addMessage({
        role: 'assistant',
        content: data.content || data.message || '',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } catch (e) {
      addMessage({ role: 'assistant', content: `Connection error: ${e instanceof Error ? e.message : 'unknown'}` });
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    addMessage({ role: 'user', content: text });

    if (mode === 'command') {
      await handleCommandMode(text);
    } else {
      await handleLlmMode(text);
    }

    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeDelegations = delegations.filter(d => !d.revoked_at);

  return (
    <div className="flex h-full">
      {/* Chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="shrink-0 px-6 py-3 border-b border-white/[.07] flex items-center gap-3">
          <MessageCircle className="w-4 h-4 text-[#C5A572]" />
          <span className="text-sm font-bold text-[#E8E8ED]">Chat</span>

          {/* Mode toggle */}
          <div className="flex gap-1 bg-[#0a0a0f] rounded-lg p-0.5 ml-auto">
            <button onClick={() => setMode('command')}
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors',
                mode === 'command' ? 'bg-[#C5A572]/15 text-[#C5A572]' : 'text-zinc-500 hover:text-zinc-300'
              )}>
              <Terminal className="w-3 h-3" />
              Command
            </button>
            <button onClick={() => setMode('llm')} disabled={!hasLlmKey}
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors',
                mode === 'llm' ? 'bg-[#C5A572]/15 text-[#C5A572]' : 'text-zinc-500 hover:text-zinc-300',
                !hasLlmKey && 'opacity-30 cursor-not-allowed'
              )}>
              <Sparkles className="w-3 h-3" />
              LLM
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600">
              <MessageCircle className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm mb-1">Agent Trust Chat</p>
              <p className="text-[10px] text-zinc-700">
                {mode === 'command'
                  ? 'Type "help" for available commands'
                  : 'Ask anything about your agents'}
              </p>
            </div>
          )}
          {messages.map(msg => (
            <ChatMessageComponent key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-6 pb-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'command' ? 'Type a command...' : 'Ask about your agents...'}
                rows={1}
                className="w-full px-4 py-3 text-xs bg-[#12121a] border border-white/[.07] rounded-xl text-zinc-300 placeholder-zinc-600 focus:border-[#C5A572]/50 focus:outline-none resize-none"
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
            </div>
            <button onClick={handleSend} disabled={!input.trim() || sending}
              className="p-3 rounded-xl bg-[#C5A572] text-[#0a0a0f] hover:bg-[#D4BC94] transition-colors disabled:opacity-30">
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2 text-[9px] text-zinc-700">
            <span className={cn('w-1.5 h-1.5 rounded-full', mode === 'command' ? 'bg-emerald-400' : hasLlmKey ? 'bg-purple-400' : 'bg-zinc-600')} />
            {mode === 'command' ? 'Command mode - direct API calls' : hasLlmKey ? 'LLM mode - Claude with tools' : 'LLM mode - set API key in settings'}
          </div>
        </div>
      </div>

      {/* Context sidebar */}
      <div className="w-64 shrink-0 border-l border-white/[.07] bg-[#12121a] p-4 overflow-y-auto hidden lg:block">
        <div className="space-y-5">
          {/* Active agents */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Agents</span>
              <span className="text-[9px] text-zinc-600 ml-auto">{agents.length}</span>
            </div>
            {agents.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center gap-2 py-1">
                <span className={cn('w-1.5 h-1.5 rounded-full', a.status === 'online' ? 'bg-emerald-400' : 'bg-zinc-600')} />
                <span className="text-[10px] text-zinc-400 truncate">{a.name}</span>
                <span className="text-[9px] text-zinc-600 ml-auto">{a.reputation?.composite_score ?? '?'}</span>
              </div>
            ))}
          </div>

          {/* Delegations */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Link2 className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Delegations</span>
              <span className="text-[9px] text-zinc-600 ml-auto">{activeDelegations.length}</span>
            </div>
            {activeDelegations.slice(0, 4).map(d => (
              <div key={d.id} className="text-[9px] text-zinc-500 py-0.5 truncate">
                {d.grantor_name} {'->'} {d.agent_name}: {d.scopes.join(', ')}
              </div>
            ))}
          </div>

          {/* Recent activity */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Activity className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Recent</span>
            </div>
            {provenance.slice(0, 5).map(p => (
              <div key={p.id} className="text-[9px] text-zinc-600 py-0.5 truncate">
                {p.agent_name}: {p.action} - {timeAgo(p.created_at)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
