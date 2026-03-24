import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, Check, Clock, Users, AlertTriangle, DollarSign,
  RefreshCw, Plus, X, Link2, Shield,
} from 'lucide-react';
import { useClientDetail, type ClientAgent, type QbVendor, type Escalation } from '../hooks/useClientDetail';
import { DELEGATION_TEMPLATES } from '../lib/constants';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const } },
};

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const ClientDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    client, company, vendors, escalations,
    loading, error,
    refetch, assignAgent, unassignAgent, triggerImport,
  } = useClientDetail(id);

  const [showAssign, setShowAssign] = useState(false);
  const [assignName, setAssignName] = useState('');
  const [assignTemplate, setAssignTemplate] = useState(1); // AP Clerk default
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [unassigningAgent, setUnassigningAgent] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#B08D3E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => navigate('/clients')} className="flex items-center gap-1.5 text-sm text-[#6B6760] hover:text-[#1A1814] mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Clients
        </button>
        <div className="bg-[#FDF0F0] border border-[#F0C6C6] text-[#C23A3A] rounded-lg p-4 text-sm">
          {error || 'Client not found'}
        </div>
      </div>
    );
  }

  const activeAgents = (client.agents || []).filter(a => a.active);
  const pendingEscalations = escalations.filter(e => e.status === 'pending');
  const template = DELEGATION_TEMPLATES[assignTemplate];

  const handleAssign = async () => {
    if (!assignName.trim()) return;
    setAssigning(true);
    setAssignError(null);
    const result = await assignAgent(assignName.trim(), [...template.scopes], 4);
    setAssigning(false);
    if (result.ok) {
      setShowAssign(false);
      setAssignName('');
    } else {
      setAssignError(result.error || 'Failed to assign agent');
    }
  };

  const handleUnassign = async (agentName: string) => {
    setUnassigningAgent(agentName);
    await unassignAgent(agentName);
    setUnassigningAgent(null);
  };

  const handleSync = async () => {
    setSyncing(true);
    await triggerImport();
    setSyncing(false);
  };

  return (
    <motion.div className="p-6 max-w-5xl mx-auto" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}>
      {/* Back + Header */}
      <motion.div variants={fadeUp}>
        <button onClick={() => navigate('/clients')} className="flex items-center gap-1.5 text-sm text-[#6B6760] hover:text-[#1A1814] mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Clients
        </button>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center">
              <Building2 className="w-5 h-5 text-[#B08D3E]" />
            </div>
            <div>
              <h1 className="text-xl font-display text-[#1A1814]">{client.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {client.industry && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F7F6F3] text-[#6B6760] border border-[#F0EDE6]">{client.industry}</span>
                )}
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${
                  client.quickbooks_connected
                    ? 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]'
                    : 'bg-[#F7F6F3] text-[#9C978E] border-[#E8E5DE]'
                }`}>
                  {client.quickbooks_connected ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {client.quickbooks_connected ? 'QB Connected' : 'Not Connected'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {client.quickbooks_connected && (
              <button onClick={handleSync} disabled={syncing} className="bg-[#FAF6ED] border border-[#E8DCC4] text-[#B08D3E] hover:bg-[#E8DCC4] text-xs font-medium rounded-md px-3 py-2 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync QB'}
              </button>
            )}
            {!client.quickbooks_connected && (
              <button onClick={() => navigate(`/connect?client=${client.id}`)} className="bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-xs rounded-md px-4 py-2 transition-colors flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Connect QuickBooks
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* QB Company Info */}
      {company && (
        <motion.div variants={fadeUp} className="bg-white border border-[#E8E5DE] rounded-lg p-4 mb-4 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Company</span>
              <p className="text-[#1A1814] font-medium">{company.company_name || company.legal_name || '-'}</p>
            </div>
            {company.legal_name && company.legal_name !== company.company_name && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Legal Name</span>
                <p className="text-[#6B6760]">{company.legal_name}</p>
              </div>
            )}
            {company.fiscal_year_start && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Fiscal Year</span>
                <p className="text-[#6B6760]">Starts month {company.fiscal_year_start}</p>
              </div>
            )}
            {company.industry_type && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Industry</span>
                <p className="text-[#6B6760]">{company.industry_type}</p>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Stats */}
      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Agents', value: activeAgents.length, icon: Users },
          { label: 'Escalations', value: pendingEscalations.length, icon: AlertTriangle, color: pendingEscalations.length > 0 ? 'text-[#B8860B]' : undefined },
          { label: 'Vendors', value: vendors.length, icon: Building2 },
          { label: 'Total Balance', value: `$${vendors.reduce((s, v) => s + (v.balance || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: DollarSign, isText: true },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#E8E5DE] rounded-lg px-4 py-3 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
            <div className="flex items-center gap-1.5 mb-1">
              <s.icon className="w-3.5 h-3.5 text-[#9C978E]" strokeWidth={1.5} />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">{s.label}</span>
            </div>
            <div className={`text-xl font-bold font-data ${s.color || 'text-[#1A1814]'}`}>
              {s.isText ? s.value : (s.value as number).toLocaleString()}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Two columns: Agents + Escalations */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {/* Agents */}
        <motion.div variants={fadeUp} className="col-span-3 bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#B08D3E]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Assigned Agents</span>
            </div>
            <button onClick={() => setShowAssign(!showAssign)} className="text-[10px] font-medium text-[#B08D3E] hover:text-[#C5A572] flex items-center gap-1 transition-colors">
              {showAssign ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              {showAssign ? 'Cancel' : 'Assign Agent'}
            </button>
          </div>

          {/* Assign form */}
          {showAssign && (
            <div className="bg-[#FAFAF8] border border-[#E8DCC4] rounded-md p-3 mb-3 space-y-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Agent Name</label>
                <input
                  value={assignName}
                  onChange={e => setAssignName(e.target.value)}
                  placeholder="e.g. AP-Clerk-1"
                  className="w-full bg-white border border-[#E8E5DE] rounded-md px-3 py-2 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] transition-colors"
                  onKeyDown={e => e.key === 'Enter' && handleAssign()}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Template</label>
                <div className="flex flex-wrap gap-1.5">
                  {DELEGATION_TEMPLATES.slice(1).map((t, i) => (
                    <button
                      key={t.label}
                      onClick={() => setAssignTemplate(i + 1)}
                      className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                        assignTemplate === i + 1
                          ? 'bg-[#FAF6ED] text-[#B08D3E] border-[#E8DCC4]'
                          : 'bg-white text-[#6B6760] border-[#E8E5DE] hover:border-[#E8DCC4]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-[#9C978E] mt-1">{template.description}{template.maxCost ? ` - up to $${template.maxCost.toLocaleString()}` : ''}</p>
              </div>
              {assignError && (
                <p className="text-xs text-[#C23A3A] bg-[#FDF0F0] border border-[#F0C6C6] rounded-md px-3 py-2">{assignError}</p>
              )}
              <button
                onClick={handleAssign}
                disabled={!assignName.trim() || assigning}
                className="bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-xs rounded-md px-4 py-2 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {assigning ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {assigning ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          )}

          {activeAgents.length === 0 ? (
            <p className="text-xs text-[#9C978E] text-center py-6">No agents assigned. Click "Assign Agent" to get started.</p>
          ) : (
            <div className="space-y-2">
              {activeAgents.map(agent => (
                <AgentRow key={agent.id} agent={agent} unassigning={unassigningAgent === agent.agent_name} onUnassign={() => handleUnassign(agent.agent_name)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Escalations */}
        <motion.div variants={fadeUp} className="col-span-2 bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#B08D3E]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Recent Escalations</span>
            </div>
            {escalations.length > 0 && (
              <button onClick={() => navigate(`/escalations?client_id=${client.id}`)} className="text-[10px] text-[#B08D3E] hover:text-[#C5A572] transition-colors">
                View all
              </button>
            )}
          </div>
          {escalations.length === 0 ? (
            <p className="text-xs text-[#9C978E] text-center py-6">No escalations for this client.</p>
          ) : (
            <div className="space-y-2">
              {escalations.slice(0, 5).map(esc => (
                <EscalationRow key={esc.id} esc={esc} />
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Vendors */}
      {vendors.length > 0 && (
        <motion.div variants={fadeUp} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#F0EDE6] flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Vendors ({vendors.length})</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#F0EDE6]">
                <th className="text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] px-4 py-2">Name</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] px-4 py-2">Email</th>
                <th className="text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] px-4 py-2">Balance</th>
                <th className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {vendors.slice(0, 20).map(v => (
                <tr key={v.id} className="border-b border-[#F0EDE6] last:border-b-0 hover:bg-[#F7F6F3] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[#1A1814]">{v.display_name}</td>
                  <td className="px-4 py-2.5 text-[#6B6760] font-mono text-xs">{v.email || '-'}</td>
                  <td className="px-4 py-2.5 text-right font-data text-[#1A1814]">{v.balance != null ? `$${v.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      v.active ? 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]' : 'bg-[#F7F6F3] text-[#9C978E] border-[#E8E5DE]'
                    }`}>{v.active ? 'Active' : 'Inactive'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vendors.length > 20 && (
            <div className="px-4 py-2 text-center text-[10px] text-[#9C978E] border-t border-[#F0EDE6]">
              Showing 20 of {vendors.length} vendors
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const AgentRow: React.FC<{ agent: ClientAgent; unassigning: boolean; onUnassign: () => void }> = ({ agent, unassigning, onUnassign }) => (
  <div className="flex items-center justify-between px-3 py-2.5 rounded-md border border-[#E8E5DE] hover:border-[#E8DCC4] transition-colors">
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-[#1A1814]">{agent.agent_name}</span>
        <span className="text-[9px] font-mono text-[#9C978E] truncate max-w-[120px]">{agent.agent_did || '-'}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        {agent.scopes.slice(0, 3).map(s => (
          <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-[#EDF4FB] text-[#2E6DA4] border border-[#B8D4F0]">{s}</span>
        ))}
        {agent.scopes.length > 3 && <span className="text-[9px] text-[#9C978E]">+{agent.scopes.length - 3}</span>}
        <span className="text-[9px] text-[#9C978E] ml-1">TTL: {agent.ttl_hours}h</span>
      </div>
    </div>
    <button
      onClick={onUnassign}
      disabled={unassigning}
      className="text-[10px] text-[#9C978E] hover:text-[#C23A3A] hover:bg-[#FDF0F0] px-2 py-1 rounded transition-colors disabled:opacity-50"
    >
      {unassigning ? '...' : 'Unassign'}
    </button>
  </div>
);

const EscalationRow: React.FC<{ esc: Escalation }> = ({ esc }) => {
  const statusColors: Record<string, string> = {
    pending: 'bg-[#FFF8E8] text-[#B8860B] border-[#F0DDB0]',
    approved: 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]',
    denied: 'bg-[#FDF0F0] text-[#C23A3A] border-[#F0C6C6]',
    expired: 'bg-[#F7F6F3] text-[#9C978E] border-[#E8E5DE]',
  };

  return (
    <div className="px-3 py-2.5 rounded-md border border-[#E8E5DE] border-l-2 border-l-[#B8860B]" style={{ borderLeftColor: esc.status === 'approved' ? '#1A7A42' : esc.status === 'denied' ? '#C23A3A' : esc.status === 'expired' ? '#9C978E' : '#B8860B' }}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#1A1814] truncate">{esc.vendor || 'Unknown'}</span>
            {esc.amount != null && <span className="text-xs font-bold font-data text-[#B08D3E]">${esc.amount.toLocaleString()}</span>}
          </div>
          <p className="text-[10px] text-[#9C978E] mt-0.5 truncate">{esc.agent_name} - {timeAgo(esc.created_at)}</p>
        </div>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border shrink-0 ${statusColors[esc.status] || ''}`}>
          {esc.status}
        </span>
      </div>
    </div>
  );
};
