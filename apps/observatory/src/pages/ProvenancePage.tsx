import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Shield, Filter } from 'lucide-react';
import { useProvenance } from '@/hooks/useProvenance';
import { useAgents } from '@/hooks/useAgents';
import { cn, timeAgo, shortId } from '@/lib/utils';
import { ACTION_DOT_COLORS } from '@/lib/constants';

type TimeRange = '1h' | 'today' | '7d' | '30d' | 'all';

export const ProvenancePage: React.FC = () => {
  const { provenance, loading } = useProvenance(200);
  const { agents } = useAgents();
  const [agentFilter, setAgentFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const actions = useMemo(() => Array.from(new Set(provenance.map(p => p.action))), [provenance]);

  const filtered = useMemo(() => {
    let items = provenance;
    if (agentFilter) items = items.filter(p => p.agent_name === agentFilter);
    if (actionFilter) items = items.filter(p => p.action === actionFilter);
    if (timeRange !== 'all') {
      const now = Date.now();
      const cutoff = {
        '1h': now - 3600000,
        'today': new Date().setHours(0, 0, 0, 0),
        '7d': now - 7 * 86400000,
        '30d': now - 30 * 86400000,
      }[timeRange];
      items = items.filter(p => new Date(p.created_at).getTime() >= cutoff);
    }
    return items;
  }, [provenance, agentFilter, actionFilter, timeRange]);

  const actionColors = ACTION_DOT_COLORS;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6">
        <Shield className="w-5 h-5 text-[#C5A572]" />
        <h1 className="text-lg font-bold text-[#E8E8ED]">Provenance</h1>
        <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-full">
          {filtered.length} entries
        </span>
      </motion.div>

      {/* Filters */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="flex items-center gap-3 mb-6">
        <Filter className="w-3.5 h-3.5 text-zinc-500" />
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
          className="text-xs bg-[#12121a] border border-white/[.07] rounded-lg px-2.5 py-1.5 text-zinc-300">
          <option value="">All agents</option>
          {agents.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          className="text-xs bg-[#12121a] border border-white/[.07] rounded-lg px-2.5 py-1.5 text-zinc-300">
          <option value="">All actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          {(['1h', 'today', '7d', '30d', 'all'] as TimeRange[]).map(r => (
            <button key={r} onClick={() => setTimeRange(r)}
              className={cn('text-[10px] px-2 py-1 rounded',
                timeRange === r ? 'bg-[#C5A572]/15 text-[#C5A572]' : 'text-zinc-600 hover:text-zinc-400'
              )}>{r}</button>
          ))}
        </div>
      </motion.div>

      {/* Timeline */}
      <div className="relative pl-8">
        {/* Vertical line */}
        <div className="absolute left-3.5 top-0 bottom-0 w-px bg-white/[.07]" />

        {filtered.map((entry, i) => {
          const isExp = expanded === entry.id;
          const dotColor = actionColors[entry.action] || 'bg-zinc-500';
          const meta = entry.metadata as Record<string, any>;
          const isMcp = meta?.type === 'mcp_tool_call';
          const risk = meta?.risk as Record<string, any> | undefined;
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
              className="relative mb-3"
            >
              {/* Dot on timeline */}
              <div className={cn('absolute -left-[18.5px] top-3 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0f]', dotColor)} />

              {/* Timestamp */}
              <div className="text-[9px] text-zinc-600 mb-1">
                {new Date(entry.created_at).toLocaleString()}
              </div>

              {/* Content card */}
              <div
                className={cn(
                  'rounded-lg bg-[#12121a] border cursor-pointer transition-colors',
                  isExp ? 'border-[#C5A572]/30' : 'border-white/[.07] hover:border-white/[.12]',
                )}
                onClick={() => setExpanded(isExp ? null : entry.id)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs font-medium text-[#E8E8ED]">{entry.agent_name}</span>
                  {meta?.type === 'mcp_tool_call' ? (
                    <>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-mono',
                        meta.status === 'denied' ? 'bg-red-500/10 text-red-400' :
                        'bg-emerald-500/10 text-emerald-400'
                      )}>
                        {meta.tool}
                      </span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        meta.status === 'denied' ? 'bg-red-500/15 text-red-400' :
                        'bg-emerald-500/15 text-emerald-400'
                      )}>
                        {meta.status === 'denied' ? '✗ DENIED' : '✓ ALLOWED'}
                      </span>
                      {risk?.risk_level && (
                        <span className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded',
                          risk?.risk_level === 'critical' ? 'bg-red-500/10 text-red-400' :
                          risk?.risk_level === 'high' ? 'bg-amber-500/10 text-amber-400' :
                          'bg-zinc-500/10 text-zinc-400'
                        )}>
                          {(risk?.risk_level as string).toUpperCase()}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded',
                        entry.action === 'delegate' ? 'bg-[#C5A572]/10 text-[#C5A572]' :
                        entry.action === 'register' ? 'bg-emerald-500/10 text-emerald-400' :
                        entry.action === 'revoke' ? 'bg-red-500/10 text-red-400' :
                        'bg-zinc-500/10 text-zinc-400'
                      )}>
                        {entry.action}
                      </span>
                      {entry.entity_ids.length > 0 && (
                        <span className="text-[10px] font-mono text-zinc-600 flex-1 truncate">
                          {entry.entity_ids.map(id => shortId(id)).join(', ')}
                        </span>
                      )}
                    </>
                  )}
                  <span className="text-[10px] text-zinc-600 shrink-0 ml-auto">{timeAgo(entry.created_at)}</span>
                </div>

                {/* Expanded view - MCP tool call with rich rendering */}
                {isExp && meta?.type === 'mcp_tool_call' && (
                  <div className="px-4 pb-4 border-t border-white/5 mt-0">
                    {meta.status === 'denied' && risk && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="text-[10px] text-[#C5A572] font-medium mb-1.5">Risk Prevented</div>
                          {(risk?.consequences as string[])?.map((c: string, i: number) => (
                            <div key={i} className="text-[11px] text-zinc-400 flex gap-2">
                              <span className="text-red-400 shrink-0">-</span> {c}
                            </div>
                          ))}
                        </div>

                        {(risk?.compliance as string[])?.length > 0 && (
                          <div>
                            <div className="text-[10px] text-[#C5A572] font-medium mb-1">Compliance Impact</div>
                            <div className="flex gap-1.5 flex-wrap">
                              {(risk?.compliance as string[]).map((c: string) => (
                                <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                                  {c}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="text-[10px] text-[#C5A572] font-medium mb-1">Context</div>
                          <div className="text-[11px] text-zinc-400">
                            Agent: <span className="text-zinc-300 font-mono">{entry.agent_name}</span>
                            {meta.agent_did && meta.agent_did !== 'unknown' && (
                              <span className="text-zinc-600 font-mono ml-1">({meta.agent_did})</span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400">{meta.deny_reason}</div>
                        </div>

                        <div>
                          <div className="text-[10px] text-[#C5A572] font-medium mb-1">Remediation</div>
                          {(risk?.remediation as string[])?.map((r: string, i: number) => (
                            <div key={i} className="text-[11px] text-zinc-400 flex gap-2">
                              <span className="text-[#C5A572] shrink-0">-</span> {r}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {meta.status === 'allowed' && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[11px] text-zinc-400">
                          Tool: <span className="text-zinc-300 font-mono">{meta.tool}</span>
                        </div>
                        {meta.args_summary && (
                          <div className="text-[11px] text-zinc-400">
                            Args: <span className="text-zinc-500 font-mono">{meta.args_summary}</span>
                          </div>
                        )}
                        <div className="text-[11px] text-zinc-400">
                          Duration: <span className="text-zinc-300">{meta.duration_ms}ms</span>
                          {' '} Result: <span className="text-emerald-400">{meta.downstream_result}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Expanded view - regular provenance (raw JSON) */}
                {isExp && meta?.type !== 'mcp_tool_call' && Object.keys(meta).length > 0 && (
                  <div className="px-4 pb-3 border-t border-white/5">
                    <pre className="text-[9px] text-zinc-500 mt-2 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}

        {filtered.length === 0 && !loading && (
          <div className="text-sm text-zinc-600 py-12 text-center">No provenance entries match your filters</div>
        )}
      </div>
    </div>
  );
};
