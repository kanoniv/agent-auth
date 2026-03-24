import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Bell, CheckCircle2, XCircle, AlertTriangle, Activity, ArrowRight, PanelLeftClose, PanelLeftOpen, LogOut,
} from 'lucide-react';
import { NAV_ITEMS } from '@/lib/constants';
import { cn, timeAgo, safeGetItem, safeSetItem } from '@/lib/utils';
import { useConnection } from '@/hooks/useConnection';
import { useMemory } from '@/hooks/useMemory';
import { SettingsPanel } from './SettingsPanel';
import { useAuth } from '@/hooks/useAuth';
import type { OutcomeEntry } from '@/lib/types';

function outcomeIcon(result: string) {
  switch (result) {
    case 'success': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failure': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'partial': return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
    default: return <Activity className="w-3.5 h-3.5 text-zinc-400" />;
  }
}

function agentFromAuthor(author: string): string {
  return author.startsWith('agent:') ? author.slice(6) : author;
}

function LogoutButton({ expanded }: { expanded: boolean }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => { logout(); navigate('/login'); };
  return (
    <motion.button
      aria-label="Sign out"
      className="w-full flex items-center h-9 px-3 gap-3 text-sm text-[#8B8B96] hover:text-[#F87171] transition-colors"
      onClick={handleLogout}
      whileHover={{ backgroundColor: 'rgba(248,113,113,0.05)' }}
      transition={{ duration: 0.1 }}
    >
      <LogOut className="w-5 h-5 shrink-0" />
      <motion.span
        className="whitespace-nowrap"
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        Sign out
      </motion.span>
    </motion.button>
  );
}

export const Layout: React.FC = () => {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const { connected, check } = useConnection();
  const { outcomes } = useMemory();
  const location = useLocation();
  const navigate = useNavigate();

  // Track which outcomes the user has "seen"
  const [lastSeenCount, setLastSeenCount] = useState(() => {
    const stored = safeGetItem('at-notif-seen');
    return stored ? parseInt(stored, 10) : 0;
  });
  const unseenCount = Math.max(0, outcomes.length - lastSeenCount);

  const handleOpenBell = () => {
    setBellOpen(prev => !prev);
    if (!bellOpen) {
      setLastSeenCount(outcomes.length);
      safeSetItem('at-notif-seen', String(outcomes.length));
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    if (bellOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

  // Listen for settings open event from other components
  useEffect(() => {
    const handler = () => setSettingsOpen(true);
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-[#0a0a0f] overflow-hidden">
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={() => { check(); }}
      />

      {/* Sidebar */}
      <motion.nav
        className="relative flex flex-col h-full bg-[#12121a] border-r border-white/[.07] z-30 overflow-hidden"
        animate={{ width: sidebarExpanded || sidebarHovered ? 220 : 48 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        {/* Logo */}
        <div className="flex items-center h-12 px-3 border-b border-white/[.07]">
          <div className="w-6 h-6 rounded bg-[#C5A572] flex items-center justify-center shrink-0 cursor-pointer"
            onClick={() => setSidebarExpanded(e => !e)}>
            <span className="text-[10px] font-bold text-[#0a0a0f]">AT</span>
          </div>
          <motion.div
            className="flex items-center gap-2 ml-3 whitespace-nowrap overflow-hidden"
            animate={{ opacity: sidebarExpanded || sidebarHovered ? 1 : 0 }}
            transition={{ duration: 0.15 }}
          >
            <span className="text-sm font-bold text-[#E8E8ED]">Agent Trust</span>
            <button
              onClick={() => setSidebarExpanded(e => !e)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors ml-auto"
            >
              {sidebarExpanded ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
            </button>
          </motion.div>
        </div>

        {/* Nav items */}
        <div className="flex-1 py-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            const Icon = item.icon;
            return (
              <motion.button
                key={item.id}
                className={cn(
                  'w-full flex items-center h-9 px-3 gap-3 text-sm transition-colors relative',
                  active ? 'text-[#C5A572]' : 'text-[#8B8B96] hover:text-[#E8E8ED]',
                )}
                onClick={() => navigate(item.path)}
                whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                transition={{ duration: 0.1 }}
              >
                {active && (
                  <motion.div
                    className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#C5A572] rounded-r"
                    layoutId="sidebar-active"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <span className="shrink-0">
                  <Icon className="w-5 h-5" />
                </span>
                <motion.span
                  className="whitespace-nowrap truncate"
                  animate={{ opacity: sidebarExpanded || sidebarHovered ? 1 : 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {item.label}
                </motion.span>
              </motion.button>
            );
          })}
        </div>

        {/* Bottom: connection + settings */}
        <div className="border-t border-white/[.07] py-2">
          <motion.button
            aria-label="Settings"
            className="w-full flex items-center h-9 px-3 gap-3 text-sm text-[#8B8B96] hover:text-[#E8E8ED] transition-colors"
            onClick={() => setSettingsOpen(true)}
            whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            transition={{ duration: 0.1 }}
          >
            <span className="shrink-0 relative">
              <Settings className="w-5 h-5" />
              <span className={cn(
                'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full',
                connected ? 'bg-emerald-400' : 'bg-zinc-600',
              )} />
            </span>
            <motion.span
              className="whitespace-nowrap"
              animate={{ opacity: sidebarExpanded || sidebarHovered ? 1 : 0 }}
              transition={{ duration: 0.15 }}
            >
              Settings
            </motion.span>
          </motion.button>
          <LogoutButton expanded={sidebarExpanded || sidebarHovered} />
        </div>
      </motion.nav>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-end h-10 px-4 border-b border-white/[.07] bg-[#0a0a0f] shrink-0">
          {/* Bell */}
          <div ref={bellRef} className="relative">
            <button
              onClick={handleOpenBell}
              aria-label={unseenCount > 0 ? `Notifications (${unseenCount} unread)` : 'Notifications'}
              className={cn(
                'relative p-1.5 rounded-lg transition-colors',
                bellOpen ? 'bg-white/[.05] text-[#E8E8ED]' : 'text-[#55555F] hover:text-[#8B8B96]',
              )}
            >
              <Bell className="w-4 h-4" />
              {unseenCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[#C5A572] text-[8px] font-bold text-[#0a0a0f] px-1">
                  {unseenCount > 99 ? '99+' : unseenCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            <AnimatePresence>
              {bellOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1.5 w-80 max-h-[420px] overflow-y-auto rounded-xl bg-[#12121a] border border-white/[.07] shadow-2xl z-50"
                >
                  <div className="px-3 py-2.5 border-b border-white/[.07] flex items-center gap-2">
                    <Bell className="w-3.5 h-3.5 text-[#C5A572]" />
                    <span className="text-xs font-semibold text-[#E8E8ED]">Agent Outcomes</span>
                    <span className="text-[9px] text-zinc-600 ml-auto">{outcomes.length} total</span>
                  </div>

                  {outcomes.length > 0 ? (
                    <div className="py-1">
                      {outcomes.slice(0, 20).map((o, i) => (
                        <NotificationItem
                          key={o.id}
                          outcome={o}
                          isNew={i < unseenCount}
                          onClick={() => {
                            setBellOpen(false);
                            navigate(`/agents/${agentFromAuthor(o.author)}`);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <Activity className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
                      <p className="text-[10px] text-zinc-600">No outcomes yet</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

const NotificationItem: React.FC<{
  outcome: OutcomeEntry;
  isNew: boolean;
  onClick: () => void;
}> = ({ outcome, isNew, onClick }) => {
  const result = outcome.metadata?.result || 'unknown';
  const agent = agentFromAuthor(outcome.author);
  const action = outcome.metadata?.action;
  const reward = outcome.metadata?.reward_signal;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 hover:bg-white/[.03] transition-colors flex items-start gap-2.5',
        isNew && 'bg-[#C5A572]/[.03]',
      )}
    >
      <div className="mt-0.5">{outcomeIcon(result)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-[#E8E8ED]">{agent}</span>
          {action && (
            <>
              <ArrowRight className="w-2.5 h-2.5 text-zinc-700" />
              <span className="text-[10px] text-zinc-500">{action}</span>
            </>
          )}
          {reward !== undefined && (
            <span className={cn(
              'text-[10px] font-mono font-bold ml-auto',
              reward >= 0 ? 'text-emerald-400' : 'text-red-400',
            )}>
              {reward >= 0 ? '+' : ''}{reward.toFixed(1)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] text-zinc-500 truncate flex-1">{outcome.title}</span>
          <span className="text-[8px] text-zinc-600 shrink-0">{timeAgo(outcome.created_at)}</span>
        </div>
      </div>
      {isNew && <span className="w-1.5 h-1.5 rounded-full bg-[#C5A572] mt-1.5 shrink-0" />}
    </button>
  );
};
