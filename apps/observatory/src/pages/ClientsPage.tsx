import { motion } from 'framer-motion';
import { Building2, Plus, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const ClientsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <motion.div
      className="p-6 max-w-5xl mx-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Firm Management</p>
        <h1 className="text-2xl font-display text-[#1A1814]">Clients</h1>
        <p className="text-[13px] text-[#6B6760] mt-1">QuickBooks connections and client firms</p>
      </div>

      <div className="flex flex-col items-center justify-center py-16">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          className="w-14 h-14 rounded-lg bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center mb-4"
        >
          <Building2 className="w-7 h-7 text-[#B08D3E]" />
        </motion.div>
        <p className="text-sm font-medium text-[#1A1814] mb-1">No clients connected</p>
        <p className="text-xs text-[#9C978E] mb-6 text-center max-w-sm">
          Connect your first QuickBooks account to start managing AI agent authorizations for your clients.
        </p>
        <button
          onClick={() => navigate('/connect')}
          className="bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-5 py-2.5 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Connect QuickBooks
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
};
