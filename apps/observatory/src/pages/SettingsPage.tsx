import { motion } from 'framer-motion';
import { Settings, Globe, Key, Bell, Shield } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const SettingsPage: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <motion.div
      className="p-6 max-w-3xl mx-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Configuration</p>
        <h1 className="text-2xl font-display text-[#1A1814]">Settings</h1>
      </div>

      <div className="space-y-4">
        {/* Account */}
        <div className="bg-white border border-[#E8E5DE] rounded-lg p-5 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Account</span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Email</label>
              <p className="text-sm text-[#1A1814]">{user?.email || 'Not set'}</p>
            </div>
            {user?.tenant_id && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Company ID</label>
                <p className="text-sm font-mono text-[#6B6760]">{user.tenant_id}</p>
              </div>
            )}
          </div>
        </div>

        {/* API Connection */}
        <div className="bg-white border border-[#E8E5DE] rounded-lg p-5 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">API Connection</span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Observatory API</label>
              <p className="text-sm font-mono text-[#6B6760]">{window.location.origin}/v1</p>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1 block">Control Plane</label>
              <p className="text-sm font-mono text-[#6B6760]">https://control.kanoniv.com</p>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white border border-[#E8E5DE] rounded-lg p-5 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">Notifications</span>
          </div>
          <p className="text-xs text-[#9C978E]">Email notifications for escalations and daily spend reports coming soon.</p>
        </div>

        {/* API Keys */}
        <div className="bg-white border border-[#E8E5DE] rounded-lg p-5 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-4 h-4 text-[#B08D3E]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">API Keys</span>
          </div>
          <p className="text-xs text-[#9C978E]">Delegation tokens are generated per-agent from the Agents page. API key management coming soon.</p>
        </div>
      </div>
    </motion.div>
  );
};
