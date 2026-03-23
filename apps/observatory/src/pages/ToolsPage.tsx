import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Wrench, Shield, ChevronDown, ChevronRight } from 'lucide-react';
import { useTools, type Tool } from '@/hooks/useTools';
import { cn, timeAgo } from '@/lib/utils';

const CATEGORY_META: Record<string, { label: string; color: string; desc: string }> = {
  read: { label: 'Read / Search', color: 'text-emerald-400', desc: 'Safe operations - query data without modification' },
  write: { label: 'Create / Update', color: 'text-blue-400', desc: 'Creates or modifies financial records' },
  delete: { label: 'Delete', color: 'text-red-400', desc: 'Destructive operations - permanently removes records' },
  unknown: { label: 'Other', color: 'text-zinc-400', desc: 'Uncategorized tools' },
};

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export const ToolsPage: React.FC = () => {
  const { byCategory, loading, tools } = useTools();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#C5A572] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Wrench className="w-5 h-5 text-[#C5A572]" />
          <h1 className="text-lg font-bold text-[#E8E8ED]">Tools</h1>
        </div>
        <div className="text-center py-16">
          <Wrench className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 mb-1">No tools discovered yet</p>
          <p className="text-xs text-zinc-600">Connect an MCP server through the Kanoniv proxy to discover available tools</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6">
        <Wrench className="w-5 h-5 text-[#C5A572]" />
        <h1 className="text-lg font-bold text-[#E8E8ED]">Tools</h1>
        <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-full">
          {tools.length} discovered
        </span>
      </motion.div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(['read', 'write', 'delete'] as const).map(cat => {
          const items = byCategory[cat];
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat} className="rounded-lg bg-[#12121a] border border-white/[.07] px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">{meta.label}</div>
              <div className={cn('text-xl font-bold', meta.color)}>{items.length}</div>
            </div>
          );
        })}
        <div className="rounded-lg bg-[#12121a] border border-white/[.07] px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Total Calls</div>
          <div className="text-xl font-bold text-[#C5A572]">{tools.reduce((s, t) => s + t.call_count + t.deny_count, 0)}</div>
        </div>
      </div>

      {/* Tool categories */}
      {(['read', 'write', 'delete', 'unknown'] as const).map(cat => {
        const items = byCategory[cat];
        if (items.length === 0) return null;
        const meta = CATEGORY_META[cat];
        const isCollapsed = collapsedCats.has(cat);

        return (
          <motion.div key={cat} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <button
              onClick={() => toggleCat(cat)}
              className="flex items-center gap-2 mb-3 w-full text-left"
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />}
              <span className={cn('text-xs font-bold', meta.color)}>{meta.label}</span>
              <span className="text-[10px] text-zinc-600">({items.length})</span>
              <span className="text-[10px] text-zinc-700 ml-2">{meta.desc}</span>
            </button>

            {!isCollapsed && (
              <div className="space-y-1.5">
                {items.map(tool => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    expanded={expanded === tool.id}
                    onToggle={() => setExpanded(expanded === tool.id ? null : tool.id)}
                    categoryColor={meta.color}
                  />
                ))}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
};

const ToolCard: React.FC<{
  tool: Tool;
  expanded: boolean;
  onToggle: () => void;
  categoryColor: string;
}> = ({ tool, expanded, onToggle, categoryColor }) => {
  return (
    <div
      className={cn(
        'rounded-lg bg-[#12121a] border cursor-pointer transition-colors',
        expanded ? 'border-[#C5A572]/30' : 'border-white/[.07] hover:border-white/[.12]',
      )}
      onClick={onToggle}
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className={cn('text-[11px] font-mono font-medium', categoryColor)}>{tool.name}</span>

        {tool.risk_level && (
          <span className={cn('text-[9px] px-1.5 py-0.5 rounded border', RISK_BADGE[tool.risk_level] || RISK_BADGE.low)}>
            {tool.risk_level.toUpperCase()}
          </span>
        )}

        {tool.description && (
          <span className="text-[10px] text-zinc-600 flex-1 truncate">{tool.description}</span>
        )}

        <span className="text-[10px] text-zinc-600 shrink-0 ml-auto flex items-center gap-3">
          {tool.call_count > 0 && (
            <span className="text-emerald-400">{tool.call_count} calls</span>
          )}
          {tool.deny_count > 0 && (
            <span className="text-red-400">{tool.deny_count} denied</span>
          )}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-white/5">
          {tool.risk_action && (
            <div className="mt-2.5">
              <div className="text-[11px] text-zinc-300 mb-1">{tool.risk_action}</div>
            </div>
          )}

          {tool.risk_consequences && tool.risk_consequences.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[#C5A572] font-medium mb-1">Consequences if Uncontrolled</div>
              {tool.risk_consequences.map((c, i) => (
                <div key={i} className="text-[11px] text-zinc-400 flex gap-2">
                  <span className="text-red-400 shrink-0">-</span> {c}
                </div>
              ))}
            </div>
          )}

          {tool.risk_compliance && tool.risk_compliance.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[#C5A572] font-medium mb-1">Compliance Impact</div>
              <div className="flex gap-1.5 flex-wrap">
                {tool.risk_compliance.map(c => (
                  <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">{c}</span>
                ))}
              </div>
            </div>
          )}

          {tool.risk_remediation && tool.risk_remediation.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[#C5A572] font-medium mb-1">Remediation</div>
              {tool.risk_remediation.map((r, i) => (
                <div key={i} className="text-[11px] text-zinc-400 flex gap-2">
                  <span className="text-[#C5A572] shrink-0">-</span> {r}
                </div>
              ))}
            </div>
          )}

          {!tool.risk_action && !tool.risk_consequences?.length && (
            <div className="mt-2 text-[11px] text-zinc-600">No risk assessment available for this tool</div>
          )}
        </div>
      )}
    </div>
  );
};
