import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import { Shield, Users, Link2, Activity, Rocket, UserPlus, GitBranch, BarChart3, Settings } from 'lucide-react';
import { useAgents } from '@/hooks/useAgents';
import { useDelegations } from '@/hooks/useDelegations';
import { useProvenance } from '@/hooks/useProvenance';
import { StatCard } from '@/components/StatCard';
import { TrustGraph } from '@/components/TrustGraph';
import { ActivityFeed } from '@/components/ActivityFeed';
import { AgentCard } from '@/components/AgentCard';
import { cn, scoreColor } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { seedDemoData } from '@/lib/seed';

const staggerItem = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

const GettingStarted: React.FC<{ onSeeded: () => void }> = ({ onSeeded }) => {
  const navigate = useNavigate();
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Register form
  const [showRegister, setShowRegister] = useState(false);
  const [regName, setRegName] = useState('');
  const [regDesc, setRegDesc] = useState('');
  const [regCaps, setRegCaps] = useState('');
  const [registering, setRegistering] = useState(false);

  const steps = [
    {
      num: 1,
      title: 'Register Agents',
      desc: 'Register AI agents with capabilities, DIDs, and descriptions',
      icon: UserPlus,
    },
    {
      num: 2,
      title: 'Grant Delegations',
      desc: 'Define trust boundaries and scope permissions between agents',
      icon: GitBranch,
    },
    {
      num: 3,
      title: 'Track Outcomes',
      desc: 'Record action results and build verifiable reputation over time',
      icon: BarChart3,
    },
  ];

  const handleSeed = async () => {
    setSeeding(true);
    setError(null);
    const result = await seedDemoData();
    setSeeding(false);
    if (result.success) {
      onSeeded();
    } else {
      setError(result.error ?? 'Failed to seed demo data');
    }
  };

  const handleRegister = async () => {
    if (!regName.trim()) return;
    setRegistering(true);
    setError(null);
    try {
      const capabilities = regCaps.split(',').map(s => s.trim()).filter(Boolean);
      const res = await apiFetch('/v1/agents/register', {
        method: 'POST',
        body: JSON.stringify({
          name: regName.trim(),
          description: regDesc.trim() || undefined,
          capabilities,
        }),
      });
      if (res.ok) {
        onSeeded();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to register agent');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center h-full p-6">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08 } },
        }}
        className="w-full max-w-2xl"
      >
        <motion.div
          variants={staggerItem}
          className="bg-white border border-[#E8E5DE] rounded-lg p-8 shadow-[0_2px_8px_rgba(26,24,20,0.06)]"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <motion.div
              variants={staggerItem}
              className="w-12 h-12 rounded-xl bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center mb-4"
            >
              <Shield className="w-6 h-6 text-[#B08D3E]" />
            </motion.div>
            <motion.h1 variants={staggerItem} className="text-xl font-bold font-display text-[#1A1814] mb-2">
              Welcome to Agent Trust
            </motion.h1>
            <motion.p variants={staggerItem} className="text-sm text-[#6B6760] max-w-md">
              The identity, delegation, and reputation layer for AI agent systems.
              Get started in three steps.
            </motion.p>
          </div>

          {/* Steps */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {steps.map((step) => (
              <motion.div
                key={step.num}
                variants={staggerItem}
                className="rounded-lg bg-[#FAFAF8] border border-[#F0EDE6] p-4 flex flex-col items-center text-center"
              >
                <div className="w-6 h-6 rounded-full bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center text-[10px] font-bold text-[#B08D3E] mb-3">
                  {step.num}
                </div>
                <step.icon className="w-4 h-4 text-[#9C978E] mb-2" />
                <span className="text-xs font-semibold text-[#1A1814] mb-1">{step.title}</span>
                <span className="text-[10px] text-[#9C978E] leading-snug">{step.desc}</span>
              </motion.div>
            ))}
          </div>

          {/* Register form */}
          <AnimatePresence>
            {showRegister && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mb-6"
              >
                <div className="rounded-lg bg-[#FAFAF8] border border-[#E8DCC4] p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <UserPlus className="w-3.5 h-3.5 text-[#B08D3E]" />
                    <span className="text-xs font-semibold text-[#1A1814]">Register Your First Agent</span>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Name *</label>
                    <input
                      value={regName}
                      onChange={e => setRegName(e.target.value)}
                      placeholder="e.g. researcher, coordinator, reviewer"
                      className="w-full px-3 py-2 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E] focus:outline-none"
                      onKeyDown={e => e.key === 'Enter' && handleRegister()}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Description</label>
                    <input
                      value={regDesc}
                      onChange={e => setRegDesc(e.target.value)}
                      placeholder="What does this agent do?"
                      className="w-full px-3 py-2 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Capabilities <span className="text-[#9C978E]">(comma-separated)</span></label>
                    <input
                      value={regCaps}
                      onChange={e => setRegCaps(e.target.value)}
                      placeholder="search, analyze, summarize"
                      className="w-full px-3 py-2 text-xs bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg text-[#1A1814] placeholder-[#9C978E] focus:border-[#B08D3E] focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleRegister}
                    disabled={!regName.trim() || registering}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#B08D3E] text-white text-xs font-bold hover:bg-[#C5A572] transition-colors disabled:opacity-50"
                  >
                    {registering ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    {registering ? 'Registering...' : 'Register Agent'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <motion.div variants={staggerItem} className="flex flex-col items-center gap-3">
            <button
              onClick={() => setShowRegister(!showRegister)}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all',
                showRegister
                  ? 'border border-[#E8E5DE] text-[#6B6760] hover:text-[#1A1814] hover:bg-[#F7F6F3]'
                  : 'bg-[#B08D3E] text-white hover:bg-[#C5A572]',
              )}
            >
              <UserPlus className="w-4 h-4" />
              {showRegister ? 'Cancel' : 'Register an Agent'}
            </button>

            <div className="flex items-center gap-3 text-[10px] text-[#9C978E]">
              <span>or</span>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="flex items-center gap-1.5 text-[10px] text-[#9C978E] hover:text-[#B08D3E] transition-colors disabled:opacity-50"
              >
                {seeding ? (
                  <div className="w-3 h-3 border-2 border-[#E8E5DE] border-t-[#B08D3E] rounded-full animate-spin" />
                ) : (
                  <Rocket className="w-3 h-3" />
                )}
                Load Demo Scenario
              </button>

              <span className="text-[#E8E5DE]">|</span>

              <button
                onClick={() => {
                  // Trigger settings panel via custom event
                  window.dispatchEvent(new CustomEvent('open-settings'));
                }}
                className="flex items-center gap-1.5 text-[10px] text-[#9C978E] hover:text-[#6B6760] transition-colors"
              >
                <Settings className="w-3 h-3" />
                Connect to existing API
              </button>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-[#C23A3A] mt-1 text-center max-w-sm"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { agents, loading, refetch: refetchAgents } = useAgents();
  const { delegations, refetch: refetchDelegations } = useDelegations();
  const { provenance, refetch: refetchProvenance } = useProvenance();

  const activeDelegations = delegations.filter(d => !d.revoked_at && (!d.expires_at || new Date(d.expires_at) > new Date()));
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const actionsToday = provenance.filter(p => new Date(p.created_at) >= todayStart).length;
  const avgScore = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + (a.reputation?.composite_score ?? 50), 0) / agents.length)
    : 0;

  const realAgents = agents.filter(a => a.name !== 'system');
  const isEmpty = realAgents.length === 0;

  const handleSeeded = () => {
    refetchAgents();
    refetchDelegations();
    refetchProvenance();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#B08D3E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isEmpty) {
    return <GettingStarted onSeeded={handleSeeded} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <Shield className="w-5 h-5 text-[#B08D3E]" />
        <h1 className="text-lg font-bold font-display text-[#1A1814]">Dashboard</h1>
        <span className="text-[10px] text-[#6B6760] bg-[#F7F6F3] px-2 py-0.5 rounded-full">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-4 gap-3"
      >
        <StatCard label="Total Agents" value={agents.length} icon={Users} />
        <StatCard label="Active Delegations" value={activeDelegations.length} icon={Link2} color="text-[#B08D3E]" />
        <StatCard label="Actions Today" value={actionsToday} icon={Activity} />
        <StatCard label="Avg Reputation" value={avgScore} color={scoreColor(avgScore)} />
      </motion.div>

      {/* Two-column: Graph + Top agents */}
      <div className="grid grid-cols-5 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="col-span-3 rounded-lg bg-white border border-[#E8E5DE] shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4 cursor-pointer hover:border-[#E8DCC4] transition-colors"
          onClick={() => navigate('/graph')}
        >
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-3.5 h-3.5 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Trust Graph</span>
            <span className="text-[9px] text-[#9C978E] ml-auto">Click to expand</span>
          </div>
          <TrustGraph
            agents={agents}
            delegations={delegations}
            selectedId={null}
            onSelect={(name) => navigate(`/agents/${name}`)}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="col-span-2 rounded-lg bg-white border border-[#E8E5DE] shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Top Agents</span>
          </div>
          <div className="space-y-1">
            {agents.slice(0, 5).map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.06 }}
              >
                <AgentCard
                  agent={agent}
                  onClick={() => navigate(`/agents/${agent.name}`)}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Activity Feed */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5 text-[#B08D3E]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Recent Activity</span>
        </div>
        <ActivityFeed entries={provenance} limit={10} />
      </motion.div>
    </div>
  );
};
