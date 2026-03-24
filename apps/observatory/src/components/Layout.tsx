import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, CheckCircle2, XCircle, AlertTriangle, Activity, ArrowRight, LogOut,
} from 'lucide-react';
import { NAV_ITEMS } from '@/lib/constants';
import { cn, timeAgo, safeGetItem, safeSetItem } from '@/lib/utils';
import { useConnection } from '@/hooks/useConnection';
import { useMemory } from '@/hooks/useMemory';
import { useAuth } from '@/hooks/useAuth';
import type { OutcomeEntry } from '@/lib/types';

function outcomeIcon(result: string) {
  switch (result) {
    case 'success': return <CheckCircle2 className="w-3.5 h-3.5 text-[#1A7A42]" />;
    case 'failure': return <XCircle className="w-3.5 h-3.5 text-[#C23A3A]" />;
    case 'partial': return <AlertTriangle className="w-3.5 h-3.5 text-[#B8860B]" />;
    default: return <Activity className="w-3.5 h-3.5 text-[#9C978E]" />;
  }
}

function agentFromAuthor(author: string): string {
  return author.startsWith('agent:') ? author.slice(6) : author;
}

export const Layout: React.FC = () => {
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const { connected } = useConnection();
  const { outcomes } = useMemory();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    if (bellOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="flex h-screen bg-[#FAFAF8] overflow-hidden">
      {/* Sidebar */}
      <nav className="w-[220px] flex flex-col h-full bg-white border-r border-[#E8E5DE] shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 h-14 px-4 border-b border-[#F0EDE6]">
          <div className="w-7 h-7 rounded-md bg-[#B08D3E] flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-white">K</span>
          </div>
          <span className="font-display text-[17px] text-[#1A1814]">Observatory</span>
        </div>

        {/* Nav items */}
        <div className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn(
                  'w-full flex items-center h-9 px-3 gap-2.5 text-[13px] rounded-md transition-colors relative',
                  active
                    ? 'bg-[#FAF6ED] text-[#B08D3E] font-semibold'
                    : 'text-[#6B6760] hover:bg-[#F7F6F3] hover:text-[#1A1814]',
                )}
                onClick={() => navigate(item.path)}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.5} />
                <span>{item.label}</span>
                {item.id === 'escalations' && unseenCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[#B8860B] text-[9px] font-bold text-white px-1">
                    {unseenCount > 99 ? '99+' : unseenCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom: user info + logout */}
        <div className="border-t border-[#F0EDE6] p-3">
          <div className="flex items-center gap-2 px-1 mb-2">
            <div className="w-7 h-7 rounded-full bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center text-[10px] font-bold text-[#B08D3E]">
              {(user?.email?.[0] || 'U').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-[#1A1814] truncate">{user?.email || 'User'}</p>
              <div className="flex items-center gap-1">
                <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-[#1A7A42]' : 'bg-[#9C978E]')} />
                <span className="text-[9px] text-[#9C978E]">{connected ? 'Connected' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 h-8 text-[12px] text-[#9C978E] hover:text-[#C23A3A] hover:bg-[#FDF0F0] rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </nav>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-end h-12 px-5 border-b border-[#F0EDE6] bg-white shrink-0">
          <div ref={bellRef} className="relative">
            <button
              onClick={handleOpenBell}
              className={cn(
                'relative p-1.5 rounded-md transition-colors',
                bellOpen ? 'bg-[#F7F6F3] text-[#1A1814]' : 'text-[#9C978E] hover:text-[#6B6760]',
              )}
            >
              <Bell className="w-4 h-4" />
              {unseenCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[#B08D3E] text-[8px] font-bold text-white px-1">
                  {unseenCount > 99 ? '99+' : unseenCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {bellOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1.5 w-80 max-h-[420px] overflow-y-auto rounded-lg bg-white border border-[#E8E5DE] shadow-lg z-50"
                >
                  <div className="px-3 py-2.5 border-b border-[#F0EDE6] flex items-center gap-2">
                    <Bell className="w-3.5 h-3.5 text-[#B08D3E]" />
                    <span className="text-xs font-semibold text-[#1A1814]">Agent Outcomes</span>
                    <span className="text-[9px] text-[#9C978E] ml-auto">{outcomes.length} total</span>
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
                      <Activity className="w-5 h-5 text-[#E8E5DE] mx-auto mb-2" />
                      <p className="text-[10px] text-[#9C978E]">No outcomes yet</p>
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
        'w-full text-left px-3 py-2 hover:bg-[#F7F6F3] transition-colors flex items-start gap-2.5',
        isNew && 'bg-[#FAF6ED]',
      )}
    >
      <div className="mt-0.5">{outcomeIcon(result)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-[#1A1814]">{agent}</span>
          {action && (
            <>
              <ArrowRight className="w-2.5 h-2.5 text-[#E8E5DE]" />
              <span className="text-[10px] text-[#9C978E]">{action}</span>
            </>
          )}
          {reward !== undefined && (
            <span className={cn(
              'text-[10px] font-mono font-bold ml-auto',
              reward >= 0 ? 'text-[#1A7A42]' : 'text-[#C23A3A]',
            )}>
              {reward >= 0 ? '+' : ''}{reward.toFixed(1)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] text-[#9C978E] truncate flex-1">{outcome.title}</span>
          <span className="text-[8px] text-[#9C978E] shrink-0">{timeAgo(outcome.created_at)}</span>
        </div>
      </div>
      {isNew && <span className="w-1.5 h-1.5 rounded-full bg-[#B08D3E] mt-1.5 shrink-0" />}
    </button>
  );
};
