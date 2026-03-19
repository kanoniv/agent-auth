import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Check, ExternalLink, Loader2, Plug, Copy, CheckCircle2 } from 'lucide-react';
import { getConnection, saveConnection } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ConnectionConfig } from '@/lib/types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type Tab = 'connection' | 'integrations';

const INTEGRATIONS = [
  {
    name: 'Python SDK',
    description: 'Cryptographic identity, delegation, and reputation for any Python agent.',
    install: 'pip install agent-trust',
    snippet: `from agent_trust import TrustAgent

trust = TrustAgent(url="http://localhost:4100")

trust.register("my-agent", capabilities=["search", "analyze"])
trust.delegate("my-agent", scopes=["search"])
trust.observe("my-agent", action="search", result="success", reward=0.9)

best = trust.select(["agent-a", "agent-b"], strategy="ucb")`,
    docs: 'https://github.com/kanoniv/agent-trust',
  },
  {
    name: 'CrewAI',
    description: 'Trust-aware task routing for CrewAI multi-agent workflows.',
    install: 'pip install crewai agent-trust',
    snippet: `from crewai import Agent, Task, Crew
from agent_trust import TrustAgent

trust = TrustAgent(url="http://localhost:4100")
trust.register("researcher", capabilities=["search", "analyze"])

# One callback - every task auto-reports to Agent Trust
def trust_callback(output):
    trust.observe(output.agent, action=output.description[:50],
                  result="success" if output.raw else "failure",
                  reward=0.8)

task = Task(
    description="Research competitor landscape",
    agent=researcher,
    callback=trust_callback  # <- plug in here
)`,
    docs: 'https://github.com/kanoniv/agent-trust/blob/main/examples/crewai_demo.py',
  },
  {
    name: 'LangChain / LangGraph',
    description: 'Agent Trust operations as LangChain tools for ReAct agents.',
    install: 'pip install langchain langchain-anthropic agent-trust',
    snippet: `from langchain_core.tools import tool
from agent_trust import TrustAgent

trust = TrustAgent(db_path=":memory:")

@tool
def select_agent(agents: str, strategy: str = "ucb") -> str:
    """Select the most trusted agent."""
    agent_list = [a.strip() for a in agents.split(",")]
    return trust.select(agent_list, strategy=strategy)`,
    docs: 'https://github.com/kanoniv/agent-trust/blob/main/examples/langchain_demo.py',
  },
  {
    name: 'MCP Server',
    description: 'Identity primitives for Claude, Cursor, and any MCP-compatible client.',
    install: 'npx @kanoniv/mcp',
    snippet: `// claude_desktop_config.json
{
  "mcpServers": {
    "agent-trust": {
      "command": "npx",
      "args": ["@kanoniv/mcp"],
      "env": {
        "KANONIV_API_KEY": "your-api-key",
        "KANONIV_BASE_URL": "http://localhost:4100"
      }
    }
  }
}`,
    docs: 'https://github.com/kanoniv/agent-trust',
  },
  {
    name: 'REST API',
    description: 'Direct HTTP calls for any language or framework.',
    install: 'curl http://localhost:4100/health',
    snippet: `# Register an agent
curl -X POST http://localhost:4100/v1/agents/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent", "capabilities": ["search"]}'

# Record an outcome
curl -X POST http://localhost:4100/v1/memory/feedback \\
  -H "Content-Type: application/json" \\
  -d '{"subject_did": "did:agent:...", "action": "search", "result": "success", "reward_signal": 0.9}'`,
    docs: 'https://github.com/kanoniv/agent-trust',
  },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, onSave }) => {
  const [config, setConfig] = useState<ConnectionConfig>(getConnection);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [tab, setTab] = useState<Tab>('connection');
  const [copied, setCopied] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const base = config.apiUrl || '';
      const headers: Record<string, string> = {};
      if (config.apiKey) headers['X-API-Key'] = config.apiKey;
      const res = await fetch(`${base}/health`, { headers });
      setTestResult(res.ok ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    saveConnection(config);
    setTestResult(null);
    onSave();
    onClose();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-[#12121a] border border-white/10 rounded-xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header + tabs */}
            <div className="px-6 pt-5 pb-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-[#C5A572]" />
                  <h2 className="text-sm font-bold text-[#E8E8ED]">Settings</h2>
                </div>
                <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">&times;</button>
              </div>
              <div className="flex gap-1 bg-[#0a0a0f] rounded-lg p-0.5">
                {([
                  { id: 'connection' as Tab, label: 'Connection', icon: ExternalLink },
                  { id: 'integrations' as Tab, label: 'Integrations', icon: Plug },
                ]).map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      tab === t.id ? 'bg-[#C5A572]/15 text-[#C5A572]' : 'text-zinc-500 hover:text-zinc-300'
                    )}>
                    <t.icon className="w-3 h-3" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {tab === 'connection' && (
                <div className="space-y-4">
                  <Field label="API Endpoint" hint="Leave empty to use the proxy (same origin)">
                    <input
                      value={config.apiUrl}
                      onChange={e => { setConfig(c => ({ ...c, apiUrl: e.target.value })); setTestResult(null); }}
                      placeholder="http://localhost:4100"
                      className="w-full px-3 py-2 text-xs bg-[#0a0a0f] border border-white/10 rounded-lg text-zinc-300 placeholder-zinc-600 focus:border-[#C5A572]/50 focus:outline-none"
                    />
                  </Field>

                  <Field label="API Key" hint="For authenticated APIs" optional>
                    <input
                      value={config.apiKey}
                      onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
                      placeholder="kn_live_..."
                      type="password"
                      className="w-full px-3 py-2 text-xs bg-[#0a0a0f] border border-white/10 rounded-lg text-zinc-300 placeholder-zinc-600 focus:border-[#C5A572]/50 focus:outline-none font-mono"
                    />
                  </Field>

                  <Field label="Agent Name" hint="Identifies this UI as an agent" optional>
                    <input
                      value={config.agentName}
                      onChange={e => setConfig(c => ({ ...c, agentName: e.target.value }))}
                      placeholder="observatory"
                      className="w-full px-3 py-2 text-xs bg-[#0a0a0f] border border-white/10 rounded-lg text-zinc-300 placeholder-zinc-600 focus:border-[#C5A572]/50 focus:outline-none"
                    />
                  </Field>

                  <Field label="LLM API Key" hint="Claude API key for chat LLM mode" optional>
                    <input
                      value={config.llmApiKey || ''}
                      onChange={e => setConfig(c => ({ ...c, llmApiKey: e.target.value }))}
                      placeholder="sk-ant-..."
                      type="password"
                      className="w-full px-3 py-2 text-xs bg-[#0a0a0f] border border-white/10 rounded-lg text-zinc-300 placeholder-zinc-600 focus:border-[#C5A572]/50 focus:outline-none font-mono"
                    />
                  </Field>

                  {testResult && (
                    <div className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
                      testResult === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    )}>
                      {testResult === 'ok' ? <Check className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                      {testResult === 'ok' ? 'Connected successfully' : 'Connection failed - check the URL'}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button onClick={handleTest} disabled={testing}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-colors disabled:opacity-50">
                      {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                      Test
                    </button>
                    <button onClick={handleSave}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#C5A572] text-[#0a0a0f] text-xs font-bold hover:bg-[#D4BC94] transition-colors">
                      <Check className="w-3 h-3" />
                      Save & Connect
                    </button>
                  </div>
                </div>
              )}

              {tab === 'integrations' && (
                <div className="space-y-4">
                  <p className="text-[10px] text-zinc-500">
                    Connect your agents to the Observatory. Install an SDK, add a few lines, and your agents report identity, delegations, and outcomes automatically.
                  </p>

                  {INTEGRATIONS.map((integration) => (
                    <IntegrationCard
                      key={integration.name}
                      integration={integration}
                      copied={copied}
                      onCopy={copyToClipboard}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const IntegrationCard: React.FC<{
  integration: typeof INTEGRATIONS[number];
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}> = ({ integration, copied, onCopy }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg bg-[#0a0a0f] border border-white/[.07] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[.02] transition-colors text-left"
      >
        <Plug className="w-3.5 h-3.5 text-[#C5A572] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-[#E8E8ED]">{integration.name}</div>
          <div className="text-[9px] text-zinc-600 truncate">{integration.description}</div>
        </div>
        <span className="text-[9px] text-zinc-600 shrink-0">{expanded ? '-' : '+'}</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
              {/* Install */}
              <div>
                <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-1">Install</div>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 text-[10px] font-mono text-[#C5A572] bg-[#12121a] rounded px-2 py-1.5 border border-white/5">
                    {integration.install}
                  </code>
                  <button
                    onClick={() => onCopy(integration.install, `install-${integration.name}`)}
                    className="p-1.5 rounded hover:bg-white/[.05] text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {copied === `install-${integration.name}` ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* Code snippet */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] text-zinc-600 uppercase tracking-wider">Quick Start</span>
                  <button
                    onClick={() => onCopy(integration.snippet, `snippet-${integration.name}`)}
                    className="flex items-center gap-1 text-[9px] text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {copied === `snippet-${integration.name}` ? (
                      <><CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Copied</>
                    ) : (
                      <><Copy className="w-2.5 h-2.5" /> Copy</>
                    )}
                  </button>
                </div>
                <pre className="text-[9px] font-mono text-zinc-400 bg-[#12121a] rounded p-2.5 border border-white/5 overflow-x-auto whitespace-pre max-h-40 overflow-y-auto">
                  {integration.snippet}
                </pre>
              </div>

              {/* Docs link */}
              <a
                href={integration.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[9px] text-[#C5A572] hover:text-[#D4BC94] transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                View full example
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, optional, children }) => (
  <div>
    <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
      {label} {optional && <span className="text-zinc-700">(optional)</span>}
    </label>
    {children}
    {hint && <p className="text-[9px] text-zinc-600 mt-1">{hint}</p>}
  </div>
);
