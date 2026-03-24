import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Search, Fingerprint, Shield, Link2, Brain, Eye,
  Plus, BarChart3, ClipboardList, CheckCircle2, XCircle,
  AlertTriangle, Activity, RefreshCw, ChevronRight,
} from 'lucide-react';
import { useAgents } from '@/hooks/useAgents';
import { useDelegations } from '@/hooks/useDelegations';
import { useProvenance } from '@/hooks/useProvenance';
import { useMemory } from '@/hooks/useMemory';
import { useRecall } from '@/hooks/useRecall';
import { useTrend } from '@/hooks/useTrend';
import { AgentCard } from '@/components/AgentCard';
import { ReputationBadge } from '@/components/ReputationBadge';
import { DelegationCard } from '@/components/DelegationCard';
import { apiFetch } from '@/lib/api';
import { cn, shortDid, scoreColor, statusDot, statusColor, timeAgo, shortId } from '@/lib/utils';
import { DEFAULT_SCOPES, EXPIRY_OPTIONS } from '@/lib/constants';
import type { AgentRecord } from '@/lib/types';

type DetailTab = 'overview' | 'rl' | 'delegations' | 'memory' | 'provenance';

export const AgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { agents, loading, refetch: refetchAgents } = useAgents();
  const { delegations, refetch: refetchDelegations } = useDelegations();
  const { provenance } = useProvenance();
  const { memories, tasks, refetch: refetchMemory } = useMemory();
  const { recallData, fetchRecall, clearRecall } = useRecall();
  const { trendData, fetchTrend, clearTrend } = useTrend();

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [trendWindow, setTrendWindow] = useState('7d');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Grant/Edit form
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [editingDelegationId, setEditingDelegationId] = useState<string | null>(null);
  const [grantGrantor, setGrantGrantor] = useState('firm-admin');
  const [grantScopes, setGrantScopes] = useState<string[]>([]);
  const [grantCustomScope, setGrantCustomScope] = useState('');
  const [grantExpiry, setGrantExpiry] = useState(0);
  const [grantMaxCost, setGrantMaxCost] = useState('');
  const [grantResources, setGrantResources] = useState('');
  const [grantShowCaveats, setGrantShowCaveats] = useState(false);

  // Task form
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskContent, setTaskContent] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');

  // Memory form
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryType, setMemoryType] = useState('knowledge');

  const selected = agents.find(a => a.name === selectedName) ?? null;
  const selectedDid = selected?.did ?? null;

  // Fetch recall + trend when agent changes
  useEffect(() => {
    if (selectedDid) {
      fetchRecall(selectedDid);
      fetchTrend(selectedDid, trendWindow);
    } else {
      clearRecall();
      clearTrend();
    }
  }, [selectedDid, trendWindow]);

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.description?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedProvenance = provenance.filter(p => p.agent_name === selectedName);
  const selectedDelegations = delegations.filter(d =>
    d.agent_name === selectedName || d.grantor_name === selectedName
  );
  const selectedTasks = tasks.filter(t => t.metadata?.assigned_to === selectedName);
  const selectedMemories = memories.filter(m =>
    m.entry_type !== 'outcome' && m.entry_type !== 'task' &&
    (m.author === `agent:${selectedName}` || m.author === 'observatory' ||
     m.subject_did === selected?.did ||
     m.linked_agents?.includes(selectedName ?? ''))
  );

  const refetchAll = () => { refetchAgents(); refetchDelegations(); refetchMemory(); };

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const errorMessage = (err: unknown, fallback: string): string => {
    if (err instanceof Error) return err.message;
    return fallback;
  };

  // Action handlers
  const handleGrantDelegation = async () => {
    if (!selectedName || grantScopes.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    const expiresAt = grantExpiry > 0 ? new Date(Date.now() + grantExpiry * 3600000).toISOString() : null;
    const caveats: Record<string, unknown> = {};
    if (grantMaxCost) caveats.max_cost = parseFloat(grantMaxCost);
    if (grantResources) caveats.resources = grantResources.split(',').map(s => s.trim()).filter(Boolean);
    try {
      if (editingDelegationId) {
        // Update existing delegation
        await apiFetch(`/v1/delegations/${editingDelegationId}`, {
          method: 'PUT',
          body: JSON.stringify({ scopes: grantScopes }),
        });
      } else {
        // Create new delegation with explicit grantor
        await apiFetch('/v1/delegations', {
          method: 'POST',
          headers: { 'X-Agent-Name': grantGrantor },
          body: JSON.stringify({
            grantor_name: grantGrantor,
            agent_name: selectedName,
            scopes: grantScopes,
            expires_at: expiresAt,
            ...(Object.keys(caveats).length > 0 ? { metadata: caveats } : {}),
          }),
        });
      }
      resetGrantForm();
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to grant delegation')); }
    finally { setActionLoading(false); }
  };

  const resetGrantForm = () => {
    setShowGrantForm(false);
    setEditingDelegationId(null);
    setGrantScopes([]);
    setGrantCustomScope('');
    setGrantExpiry(0);
    setGrantMaxCost('');
    setGrantResources('');
    setGrantShowCaveats(false);
    setGrantGrantor('firm-admin');
  };

  const handleEditDelegation = (delegation: { id: string; grantor_name: string; scopes: string[] }) => {
    setEditingDelegationId(delegation.id);
    setGrantGrantor(delegation.grantor_name);
    setGrantScopes([...delegation.scopes]);
    setShowGrantForm(true);
  };

  const handleRevoke = async (id: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/delegations/${id}`, { method: 'DELETE' });
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to revoke delegation')); }
    finally { setActionLoading(false); }
  };

  const handleRemoveScope = async (id: string, scopes: string[], scope: string) => {
    const newScopes = scopes.filter(s => s !== scope);
    if (newScopes.length === 0) return handleRevoke(id);
    setActionLoading(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/delegations/${id}`, { method: 'PUT', body: JSON.stringify({ scopes: newScopes }) });
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to update delegation scopes')); }
    finally { setActionLoading(false); }
  };

  const handleCreateTask = async () => {
    if (!taskTitle || !selectedName) return;
    setActionLoading(true);
    setActionError(null);
    const slug = `task-${taskTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 180)}-${Date.now()}`;
    try {
      await apiFetch('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({
          entry_type: 'task', slug, title: taskTitle, content: taskContent,
          author: 'observatory', metadata: { assigned_to: selectedName, priority: taskPriority, status: 'open' },
        }),
      });
      setShowTaskForm(false); setTaskTitle(''); setTaskContent('');
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to create task')); }
    finally { setActionLoading(false); }
  };

  const handleCompleteTask = async (id: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/memory/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'resolved', metadata: { status: 'done' } }) });
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to complete task')); }
    finally { setActionLoading(false); }
  };

  const handleCreateMemory = async () => {
    if (!memoryTitle) return;
    setActionLoading(true);
    setActionError(null);
    const slug = `obs-${memoryType}-${memoryTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 160)}-${Date.now()}`;
    try {
      await apiFetch('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ entry_type: memoryType, slug, title: memoryTitle, content: memoryContent, author: 'observatory' }),
      });
      setShowMemoryForm(false); setMemoryTitle(''); setMemoryContent('');
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to save memory')); }
    finally { setActionLoading(false); }
  };

  const handleArchiveMemory = async (id: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/memory/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'archived' }) });
      refetchAll();
    } catch (err) { setActionError(errorMessage(err, 'Failed to archive memory')); }
    finally { setActionLoading(false); }
  };

  const outcomeIcon = (result: string) => {
    switch (result) {
      case 'success': return <CheckCircle2 className="w-3.5 h-3.5 text-[#1A7A42]" />;
      case 'failure': return <XCircle className="w-3.5 h-3.5 text-[#C23A3A]" />;
      case 'partial': return <AlertTriangle className="w-3.5 h-3.5 text-[#B8860B]" />;
      default: return <Activity className="w-3.5 h-3.5 text-[#9C978E]" />;
    }
  };

  const tabs: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Fingerprint className="w-3 h-3" /> },
    { id: 'rl', label: 'RL Insights', icon: <BarChart3 className="w-3 h-3" /> },
    { id: 'delegations', label: 'Delegations', icon: <Link2 className="w-3 h-3" /> },
    { id: 'memory', label: 'Memory', icon: <Brain className="w-3 h-3" /> },
    { id: 'provenance', label: 'Provenance', icon: <Eye className="w-3 h-3" /> },
  ];

  return (
    <div className="flex h-full">
      {/* Left panel - agent list */}
      <div className="w-[340px] shrink-0 border-r border-[#E8E5DE] flex flex-col">
        <div className="p-3 border-b border-[#E8E5DE]">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-[#B08D3E]" />
            <span className="text-sm font-bold font-display text-[#1A1814]">Agents</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] bg-[#F7F6F3] px-1.5 py-0.5 rounded-full ml-auto font-data">
              {agents.length}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9C978E]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E]/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading && agents.length === 0 ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-[#B08D3E] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            filteredAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={selectedName === agent.name}
                onClick={() => setSelectedName(selectedName === agent.name ? null : agent.name)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel - detail */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div
              key={selected.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-6"
            >
              {/* Header */}
              <div className="flex items-start gap-4 mb-6">
                <ReputationBadge score={selected.reputation?.composite_score ?? 50} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold font-display text-[#1A1814]">{selected.name}</h2>
                    <span className={cn('w-2 h-2 rounded-full', statusDot(selected.status))} />
                    <span className={cn('text-xs', statusColor(selected.status))}>{selected.status}</span>
                    <button
                      onClick={() => navigate(`/agents/${selected.name}`)}
                      className="ml-auto text-[10px] text-[#9C978E] hover:text-[#B08D3E] transition-colors"
                    >
                      Full view
                    </button>
                  </div>
                  {selected.description && <p className="text-xs text-[#6B6760]">{selected.description}</p>}
                  {selected.did && (
                    <p className="text-[10px] font-mono text-[#9C978E] mt-1">{shortDid(selected.did)}</p>
                  )}
                </div>
              </div>

              {/* Error banner */}
              {actionError && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-[#FDF0F0] border border-[#C23A3A]/20 flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 text-[#C23A3A] shrink-0" />
                  <span className="text-xs text-[#C23A3A] flex-1">{actionError}</span>
                  <button onClick={() => setActionError(null)} className="text-[#C23A3A]/60 hover:text-[#C23A3A] text-xs">dismiss</button>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 bg-[#FAFAF8] rounded-lg p-1 mb-5">
                {tabs.map(t => (
                  <button key={t.id} onClick={() => setDetailTab(t.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      detailTab === t.id ? 'bg-[#FAF6ED] text-[#B08D3E]' : 'text-[#6B6760] hover:text-[#1A1814]'
                    )}>
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  {/* Reputation breakdown */}
                  <div className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-3">Reputation Breakdown</h3>
                    {selected.reputation && (
                      <div className="space-y-3">
                        {[
                          { label: 'Activity', value: Math.min(100, Math.log2((selected.reputation.total_actions || 0) + 1) * 15), weight: '30%' },
                          { label: 'Success Rate', value: (selected.reputation.success_rate ?? 1) * 100, weight: '25%' },
                          { label: 'Feedback', value: ((selected.reputation.feedback_score ?? 0) + 1) / 2 * 100, weight: '20%' },
                          { label: 'Tenure', value: Math.min(100, ((selected.reputation.tenure_days ?? 0) / 90) * 100), weight: '15%' },
                          { label: 'Diversity', value: Math.min(100, ((selected.reputation.action_diversity ?? 0) / 7) * 100), weight: '10%' },
                        ].map(b => (
                          <div key={b.label}>
                            <div className="flex items-center justify-between text-[10px] mb-1">
                              <span className="text-[#6B6760]">{b.label}</span>
                              <span className="text-[#9C978E] font-data">{b.weight}</span>
                            </div>
                            <div className="h-1.5 bg-[#F7F6F3] rounded-full overflow-hidden">
                              <div className="h-full bg-[#B08D3E] rounded-full transition-all duration-500"
                                style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Capabilities */}
                  {selected.capabilities.length > 0 && (
                    <div className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4">
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-2">Capabilities</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.capabilities.map(cap => (
                          <span key={cap} className="text-[10px] px-2 py-1 rounded-md bg-[#FAFAF8] text-[#6B6760] border border-[#F0EDE6]">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Total Actions', value: selected.reputation?.total_actions ?? 0 },
                      { label: 'Tenure', value: `${selected.reputation?.tenure_days ?? 0}d` },
                      { label: 'Last Seen', value: timeAgo(selected.last_seen_at) },
                    ].map(s => (
                      <div key={s.label} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3 text-center">
                        <div className="text-sm font-bold font-data text-[#1A1814]">{s.value}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailTab === 'rl' && (
                <div className="space-y-4">
                  {recallData && recallData.summary.total_outcomes > 0 ? (
                    <>
                      <div className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3">
                        <div className="text-xs text-[#6B6760] text-center py-4">Trend: {recallData.summary.recent_trend}</div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Success', value: recallData.summary.success_rate !== null ? `${(recallData.summary.success_rate * 100).toFixed(0)}%` : '-', color: 'text-[#1A7A42]' },
                          { label: 'Avg Reward', value: recallData.summary.avg_reward !== null ? recallData.summary.avg_reward.toFixed(2) : '-', color: 'text-[#B08D3E]' },
                          { label: 'Outcomes', value: String(recallData.summary.total_outcomes), color: 'text-[#1A1814]' },
                        ].map(s => (
                          <div key={s.label} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3 text-center">
                            <div className={cn('text-lg font-bold font-mono font-data', s.color)}>{s.value}</div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mt-0.5">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {trendData && trendData.points.length > 1 && (
                        <div className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-[#6B6760] font-medium">Reward Signal</span>
                            <div className="flex gap-1">
                              {['24h', '7d', '30d'].map(w => (
                                <button key={w} onClick={() => setTrendWindow(w)}
                                  className={cn('text-[10px] px-2 py-1 rounded',
                                    trendWindow === w ? 'bg-[#FAF6ED] text-[#B08D3E]' : 'text-[#9C978E] hover:text-[#6B6760]'
                                  )}>{w}</button>
                              ))}
                            </div>
                          </div>
                          <div className="text-xs text-[#9C978E] text-center py-6">{trendData.points.length} data points</div>
                        </div>
                      )}

                      {(recallData.summary.top_success_actions.length > 0 || recallData.summary.top_failure_actions.length > 0) && (
                        <div className="flex gap-4">
                          {recallData.summary.top_success_actions.length > 0 && (
                            <div className="flex-1">
                              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5">Strong at</div>
                              <div className="flex flex-wrap gap-1">
                                {recallData.summary.top_success_actions.map(a => (
                                  <span key={a} className="text-[10px] px-2 py-0.5 rounded bg-[#EDFAF2] text-[#1A7A42] border border-[#1A7A42]/20">{a}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {recallData.summary.top_failure_actions.length > 0 && (
                            <div className="flex-1">
                              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5">Weak at</div>
                              <div className="flex flex-wrap gap-1">
                                {recallData.summary.top_failure_actions.map(a => (
                                  <span key={a} className="text-[10px] px-2 py-0.5 rounded bg-[#FDF0F0] text-[#C23A3A] border border-[#C23A3A]/20">{a}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-2">Recent Outcomes</div>
                        <div className="space-y-1.5">
                          {recallData.entries.slice(0, 8).map(o => (
                            <div key={o.id} className="flex items-center gap-2 bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] px-3 py-2">
                              {outcomeIcon(o.metadata?.result ?? '')}
                              <span className="text-[10px] text-[#1A1814] flex-1 truncate">{o.title}</span>
                              {o.metadata?.reward_signal !== undefined && (
                                <span className={cn('text-[10px] font-mono font-data',
                                  o.metadata.reward_signal >= 0 ? 'text-[#1A7A42]' : 'text-[#C23A3A]'
                                )}>
                                  {o.metadata.reward_signal >= 0 ? '+' : ''}{o.metadata.reward_signal.toFixed(1)}
                                </span>
                              )}
                              <span className="text-[9px] text-[#9C978E]">{timeAgo(o.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-[#9C978E] py-8 text-center">
                      {selected.did ? 'No outcomes recorded yet' : 'Agent has no DID - register with a DID to enable RL'}
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'delegations' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-[#6B6760]">{selectedDelegations.length} delegation{selectedDelegations.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => setShowGrantForm(!showGrantForm)}
                      className="ml-auto flex items-center gap-1 text-[10px] text-[#B08D3E] hover:text-[#C5A572] transition-colors">
                      <Plus className="w-3 h-3" /> Grant
                    </button>
                  </div>

                  {showGrantForm && (
                    <div className="bg-white border border-[#E8DCC4] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3 space-y-3">
                      {/* Title */}
                      <div className="text-[10px] font-semibold text-[#B08D3E]">
                        {editingDelegationId ? 'Edit Delegation' : 'New Delegation'}
                      </div>

                      {/* Grantor picker */}
                      {!editingDelegationId && (
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5 block">Grantor (who authorizes)</label>
                          <select
                            value={grantGrantor}
                            onChange={e => setGrantGrantor(e.target.value)}
                            className="w-full text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg px-2.5 py-1.5 text-[#1A1814]"
                          >
                            {agents.filter(a => a.name !== selectedName).map(a => (
                              <option key={a.name} value={a.name}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Scope selection */}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5 block">Scopes</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {DEFAULT_SCOPES.map(scope => (
                            <button key={scope} onClick={() => setGrantScopes(s =>
                              s.includes(scope) ? s.filter(x => x !== scope) : [...s, scope]
                            )}
                              className={cn('text-[10px] px-2 py-1 rounded border transition-colors',
                                grantScopes.includes(scope)
                                  ? 'bg-[#FAF6ED] text-[#B08D3E] border-[#E8DCC4]'
                                  : 'text-[#6B6760] border-[#E8E5DE] hover:border-[#B08D3E]/30'
                              )}>{scope}</button>
                          ))}
                        </div>
                        {/* Custom scope input */}
                        <div className="flex gap-1.5">
                          <input
                            value={grantCustomScope}
                            onChange={e => setGrantCustomScope(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && grantCustomScope.trim()) {
                                const scope = grantCustomScope.trim();
                                if (!grantScopes.includes(scope)) setGrantScopes(s => [...s, scope]);
                                setGrantCustomScope('');
                              }
                            }}
                            placeholder="Custom scope (e.g. billing.approve)"
                            className="flex-1 px-2 py-1.5 text-[10px] bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E]/50 focus:outline-none"
                          />
                          <button
                            onClick={() => {
                              const scope = grantCustomScope.trim();
                              if (scope && !grantScopes.includes(scope)) {
                                setGrantScopes(s => [...s, scope]);
                                setGrantCustomScope('');
                              }
                            }}
                            disabled={!grantCustomScope.trim()}
                            className="px-2 py-1.5 text-[10px] rounded border border-[#E8E5DE] text-[#6B6760] hover:text-[#B08D3E] hover:border-[#E8DCC4] transition-colors disabled:opacity-30"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        {/* Show selected custom scopes */}
                        {grantScopes.filter(s => !DEFAULT_SCOPES.includes(s)).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {grantScopes.filter(s => !DEFAULT_SCOPES.includes(s)).map(scope => (
                              <button key={scope} onClick={() => setGrantScopes(s => s.filter(x => x !== scope))}
                                className="text-[10px] px-2 py-1 rounded border bg-[#FAF6ED] text-[#B08D3E] border-[#E8DCC4] hover:bg-[#FDF0F0] hover:text-[#C23A3A] hover:border-[#C23A3A]/20 transition-colors">
                                {scope} &times;
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Expiry */}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5 block">Expiry</label>
                        <select value={grantExpiry} onChange={e => setGrantExpiry(Number(e.target.value))}
                          className="w-full text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg px-2 py-1.5 text-[#1A1814]">
                          {EXPIRY_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Caveats toggle */}
                      <button
                        onClick={() => setGrantShowCaveats(!grantShowCaveats)}
                        className="text-[10px] text-[#6B6760] hover:text-[#1A1814] transition-colors"
                      >
                        {grantShowCaveats ? '- Hide caveats' : '+ Add caveats (budget, resources)'}
                      </button>

                      {grantShowCaveats && (
                        <div className="space-y-2 pl-2 border-l-2 border-[#F0EDE6]">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">
                              Max Cost <span className="text-[#9C978E]/60">(optional)</span>
                            </label>
                            <input
                              value={grantMaxCost}
                              onChange={e => setGrantMaxCost(e.target.value)}
                              placeholder="e.g. 50"
                              type="number"
                              className="w-full px-2 py-1.5 text-[10px] bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E]/50 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">
                              Allowed Resources <span className="text-[#9C978E]/60">(comma-separated, optional)</span>
                            </label>
                            <input
                              value={grantResources}
                              onChange={e => setGrantResources(e.target.value)}
                              placeholder="e.g. db-prod, api-gateway, s3-uploads"
                              className="w-full px-2 py-1.5 text-[10px] bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E]/50 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      <button onClick={handleGrantDelegation} disabled={grantScopes.length === 0 || actionLoading}
                        className="w-full text-xs py-2 rounded-md bg-[#B08D3E] text-white font-semibold disabled:opacity-50 hover:bg-[#C5A572] transition-colors">
                        {editingDelegationId ? 'Update Delegation' : 'Grant Delegation'}
                      </button>
                      {editingDelegationId && (
                        <button onClick={resetGrantForm}
                          className="w-full text-xs py-1.5 rounded-lg text-[#6B6760] hover:text-[#1A1814] transition-colors">
                          Cancel
                        </button>
                      )}
                    </div>
                  )}

                  {selectedDelegations.map(d => (
                    <div key={d.id} onClick={() => handleEditDelegation(d)} className="cursor-pointer">
                      <DelegationCard delegation={d} onRevoke={handleRevoke} onRemoveScope={handleRemoveScope} />
                    </div>
                  ))}
                </div>
              )}

              {detailTab === 'memory' && (
                <div className="space-y-4">
                  {/* Tasks */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <ClipboardList className="w-3 h-3 text-[#6B6760]" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Tasks</span>
                      <button onClick={() => setShowTaskForm(!showTaskForm)}
                        className="ml-auto text-[10px] text-[#B08D3E] hover:text-[#C5A572]">
                        <Plus className="w-3 h-3 inline" /> Add
                      </button>
                    </div>
                    {showTaskForm && (
                      <div className="bg-white border border-[#E8DCC4] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3 space-y-2 mb-2">
                        <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task title"
                          className="w-full px-2 py-1.5 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:outline-none focus:border-[#B08D3E]/50" />
                        <textarea value={taskContent} onChange={e => setTaskContent(e.target.value)} placeholder="Description"
                          className="w-full px-2 py-1.5 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:outline-none focus:border-[#B08D3E]/50 h-16 resize-none" />
                        <div className="flex gap-2">
                          <select value={taskPriority} onChange={e => setTaskPriority(e.target.value)}
                            className="text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded px-2 py-1.5 text-[#1A1814]">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                          <button onClick={handleCreateTask} disabled={!taskTitle || actionLoading}
                            className="flex-1 text-xs py-1.5 rounded-md bg-[#B08D3E] text-white font-semibold disabled:opacity-50 hover:bg-[#C5A572] transition-colors">Create</button>
                        </div>
                      </div>
                    )}
                    {selectedTasks.length > 0 ? selectedTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-2 bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] px-3 py-2 mb-1.5">
                        <button onClick={() => handleCompleteTask(t.id)}
                          className="text-[#9C978E] hover:text-[#1A7A42] transition-colors">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] text-[#1A1814] flex-1">{t.title}</span>
                        <span className={cn('text-[9px] px-1.5 py-0.5 rounded',
                          t.metadata?.priority === 'high' ? 'bg-[#FDF0F0] text-[#C23A3A]' :
                          t.metadata?.priority === 'low' ? 'bg-[#F7F6F3] text-[#6B6760]' :
                          'bg-[#FAF6ED] text-[#B8860B]'
                        )}>{t.metadata?.priority || 'medium'}</span>
                      </div>
                    )) : <div className="text-[10px] text-[#9C978E] py-2">No tasks assigned</div>}
                  </div>

                  {/* Memory entries */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-3 h-3 text-[#6B6760]" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Memory</span>
                      <button onClick={() => setShowMemoryForm(!showMemoryForm)}
                        className="ml-auto text-[10px] text-[#B08D3E] hover:text-[#C5A572]">
                        <Plus className="w-3 h-3 inline" /> Add
                      </button>
                    </div>
                    {showMemoryForm && (
                      <div className="bg-white border border-[#E8DCC4] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-3 space-y-2 mb-2">
                        <select value={memoryType} onChange={e => setMemoryType(e.target.value)}
                          className="w-full text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded px-2 py-1.5 text-[#1A1814]">
                          {['knowledge', 'decision', 'investigation', 'pattern'].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <input value={memoryTitle} onChange={e => setMemoryTitle(e.target.value)} placeholder="Title"
                          className="w-full px-2 py-1.5 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:outline-none focus:border-[#B08D3E]/50" />
                        <textarea value={memoryContent} onChange={e => setMemoryContent(e.target.value)} placeholder="Content"
                          className="w-full px-2 py-1.5 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded text-[#1A1814] placeholder-[#9C978E] focus:outline-none focus:border-[#B08D3E]/50 h-16 resize-none" />
                        <button onClick={handleCreateMemory} disabled={!memoryTitle || actionLoading}
                          className="w-full text-xs py-1.5 rounded-md bg-[#B08D3E] text-white font-semibold disabled:opacity-50 hover:bg-[#C5A572] transition-colors">Save</button>
                      </div>
                    )}
                    {selectedMemories.length > 0 ? selectedMemories.slice(0, 10).map(m => {
                      const isExpanded = expandedMemoryId === m.id;
                      return (
                        <div key={m.id} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] mb-1.5 overflow-hidden">
                          <button
                            onClick={() => setExpandedMemoryId(isExpanded ? null : m.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F7F6F3] transition-colors"
                          >
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F3EEFF] text-[#7C3AED] border border-[#7C3AED]/20 shrink-0">{m.entry_type}</span>
                            <span className={cn('text-[10px] text-[#1A1814] flex-1', !isExpanded && 'truncate')}>{m.title}</span>
                            <ChevronRight className={cn('w-3 h-3 text-[#9C978E] shrink-0 transition-transform', isExpanded && 'rotate-90')} />
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2">
                              {m.content && (
                                <p className="text-[10px] text-[#6B6760] leading-relaxed">{m.content}</p>
                              )}
                              <div className="flex items-center gap-3 text-[9px] text-[#9C978E]">
                                <span>{m.author}</span>
                                <span>{new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                <button onClick={() => handleArchiveMemory(m.id)}
                                  className="ml-auto text-[#9C978E] hover:text-[#C23A3A] transition-colors">archive</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }) : <div className="text-[10px] text-[#9C978E] py-2">No memory entries</div>}
                  </div>
                </div>
              )}

              {detailTab === 'provenance' && (
                <div className="space-y-1.5">
                  {selectedProvenance.length > 0 ? selectedProvenance.slice(0, 20).map(p => (
                    <div key={p.id} className="flex items-center gap-2 bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] px-3 py-2">
                      <span className="text-[10px] text-[#B08D3E] min-w-[60px]">{p.action}</span>
                      <span className="text-[9px] font-mono text-[#9C978E] flex-1 truncate">
                        {p.entity_ids.map(id => shortId(id)).join(', ')}
                      </span>
                      <span className="text-[9px] text-[#9C978E] shrink-0">{timeAgo(p.created_at)}</span>
                    </div>
                  )) : (
                    <div className="text-[10px] text-[#9C978E] py-8 text-center">No provenance entries</div>
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col items-center justify-center h-full text-[#9C978E]"
            >
              <Users className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select an agent</p>
              <p className="text-[10px] text-[#9C978E] mt-1">Click an agent from the list to view details</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
