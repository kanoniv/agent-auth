import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Plus, ArrowRight, Check, Trash2, Users, Clock, AlertTriangle, Link2 } from 'lucide-react';
import { useClients, type Client } from '../hooks/useClients';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

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
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export const ClientsPage: React.FC = () => {
  const navigate = useNavigate();
  const { clients, loading, error, createClient, deleteClient } = useClients();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    const result = await createClient(name.trim(), industry.trim() || undefined);
    setCreating(false);
    if (result.ok) {
      setShowAdd(false);
      setName('');
      setIndustry('');
    } else {
      setCreateError(result.error || 'Failed to create client');
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await deleteClient(id);
    setDeletingId(null);
  };

  const isEmpty = clients.length === 0 && !loading;

  return (
    <motion.div className="p-6 max-w-5xl mx-auto" initial="hidden" animate="show" variants={stagger}>
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Firm Management</p>
          <h1 className="text-2xl font-display text-[#1A1814]">Clients</h1>
          <p className="text-[13px] text-[#6B6760] mt-1">
            {clients.length > 0
              ? `${clients.length} client${clients.length !== 1 ? 's' : ''} connected`
              : 'QuickBooks connections and client firms'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className={showAdd
            ? 'bg-white border border-[#E8E5DE] text-[#6B6760] hover:bg-[#F7F6F3] text-sm font-medium rounded-md px-4 py-2 transition-colors'
            : 'bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-4 py-2 transition-colors flex items-center gap-2'
          }
        >
          {showAdd ? 'Cancel' : <><Plus className="w-4 h-4" /> Add Client</>}
        </button>
      </motion.div>

      {/* Add Client Form */}
      {showAdd && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-6"
        >
          <div className="bg-white border border-[#E8DCC4] rounded-lg p-5 shadow-[0_2px_8px_rgba(26,24,20,0.06)]">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="w-4 h-4 text-[#B08D3E]" />
                <span className="text-xs font-semibold text-[#1A1814]">Add a Client Firm</span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5 block">Client Name *</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-md px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] focus:ring-2 focus:ring-[#FAF6ED] transition-colors"
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5 block">Industry</label>
                  <input
                    value={industry}
                    onChange={e => setIndustry(e.target.value)}
                    placeholder="e.g. Manufacturing, Healthcare"
                    className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-md px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] focus:ring-2 focus:ring-[#FAF6ED] transition-colors"
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  />
                </div>
              </div>
              {createError && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-md bg-[#FDF0F0] border border-[#F0C6C6] text-sm text-[#C23A3A] flex items-center gap-2 mb-4"
                >
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {createError}
                </motion.div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={!name.trim() || creating}
                  className="bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-5 py-2.5 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {creating ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {creating ? 'Creating...' : 'Create Client'}
                </button>
                <span className="text-[10px] text-[#9C978E] flex items-center">
                  or <button onClick={() => navigate('/connect')} className="text-[#B08D3E] hover:text-[#C5A572] ml-1 font-medium transition-colors">connect QuickBooks</button> to auto-import
                </span>
              </div>
          </div>
        </motion.div>
      )}

      {/* Error state */}
      {error && !loading && (
        <motion.div variants={fadeUp} className="p-4 rounded-lg bg-[#FFF8E8] border border-[#F0DDB0] text-sm text-[#B8860B] flex items-center gap-2 mb-6">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Could not load clients from control plane. {error}
        </motion.div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-lg bg-white border border-[#E8E5DE] animate-pulse" />
          ))}
        </div>
      ) : isEmpty && !showAdd ? (
        /* Empty state - only show when form is NOT open */
        <motion.div variants={fadeUp} className="flex flex-col items-center justify-center py-16">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            className="w-14 h-14 rounded-lg bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center mb-4"
          >
            <Building2 className="w-7 h-7 text-[#B08D3E]" />
          </motion.div>
          <p className="text-sm font-medium text-[#1A1814] mb-1">No clients yet</p>
          <p className="text-xs text-[#9C978E] mb-6 text-center max-w-sm">
            Add your first client firm to start managing AI agent authorizations.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAdd(true)}
              className="bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-5 py-2.5 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Client
            </button>
            <button
              onClick={() => navigate('/connect')}
              className="bg-[#FAF6ED] border border-[#E8DCC4] text-[#B08D3E] hover:bg-[#E8DCC4] font-medium text-sm rounded-md px-5 py-2.5 transition-colors flex items-center gap-2"
            >
              <Link2 className="w-4 h-4" /> Connect QuickBooks
            </button>
          </div>
        </motion.div>
      ) : clients.length === 0 && showAdd ? (
        null /* Form is visible above, no list to show */
      ) : (
        /* Client list */
        <motion.div variants={stagger} className="space-y-3">
          {clients.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              deleting={deletingId === client.id}
              onDelete={() => handleDelete(client.id)}
              onNavigate={() => navigate(`/clients/${client.id}`)}
              onConnect={() => navigate(`/connect?client=${client.id}`)}
            />
          ))}
        </motion.div>
      )}
    </motion.div>
  );
};

const ClientCard: React.FC<{
  client: Client;
  deleting: boolean;
  onDelete: () => void;
  onNavigate: () => void;
  onConnect: () => void;
}> = ({ client, deleting, onDelete, onNavigate, onConnect }) => {
  return (
    <motion.div
      variants={fadeUp}
      className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] overflow-hidden"
    >
      <div className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-[#F7F6F3] transition-colors" onClick={onNavigate}>
        <div className="flex items-center gap-4 min-w-0">
          {/* Icon */}
          <div className="w-10 h-10 rounded-md bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#B08D3E]" />
          </div>

          {/* Info */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#1A1814]">{client.name}</span>
              {client.industry && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F7F6F3] text-[#6B6760] border border-[#F0EDE6]">
                  {client.industry}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              {/* QB status */}
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${
                client.quickbooks_connected
                  ? 'bg-[#EDFAF2] text-[#1A7A42] border-[#C6F0D6]'
                  : 'bg-[#F7F6F3] text-[#9C978E] border-[#E8E5DE]'
              }`}>
                {client.quickbooks_connected ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                {client.quickbooks_connected ? 'QB Connected' : 'Not Connected'}
              </span>
              {/* Agent count */}
              <span className="inline-flex items-center gap-1 text-[10px] text-[#6B6760]">
                <Users className="w-3 h-3" />
                {client.agent_count} agent{client.agent_count !== 1 ? 's' : ''}
              </span>
              {/* Created */}
              <span className="text-[10px] text-[#9C978E]">
                Added {timeAgo(client.created_at)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {!client.quickbooks_connected && (
            <button
              onClick={(e) => { e.stopPropagation(); onConnect(); }}
              className="bg-[#FAF6ED] border border-[#E8DCC4] text-[#B08D3E] hover:bg-[#E8DCC4] text-xs font-medium rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5"
            >
              <Link2 className="w-3 h-3" /> Connect QB
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            className="p-1.5 rounded-md text-[#9C978E] hover:text-[#C23A3A] hover:bg-[#FDF0F0] transition-colors disabled:opacity-50"
            title="Delete client"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-[#9C978E] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
