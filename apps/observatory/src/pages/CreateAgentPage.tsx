import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Copy, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { DELEGATION_TEMPLATES } from '../lib/constants';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const } },
};

export const CreateAgentPage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [templateIdx, setTemplateIdx] = useState(1); // AP Clerk default
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = DELEGATION_TEMPLATES[templateIdx];

  const handleCreate = () => {
    if (!name.trim()) { setError('Agent name is required'); return; }
    setError(null);

    // Generate delegation token from template
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const agentDid = `did:key:z6Mk_${name.toLowerCase().replace(/\s+/g, '_')}`;

    const payload = {
      agent_did: agentDid,
      agent_name: name.trim(),
      scopes: [...template.scopes],
      max_cost: template.maxCost,
      daily_limit: template.maxCost ? template.maxCost * 5 : 0,
      expires_at: expiresAt,
    };

    const tokenB64 = btoa(JSON.stringify(payload));
    setToken(tokenB64);
  };

  const handleCopy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Token display state
  if (token) {
    return (
      <motion.div
        className="p-6 max-w-2xl mx-auto"
        initial="hidden" animate="show" variants={stagger}
      >
        <motion.div variants={fadeUp} className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          >
            <Shield className="w-10 h-10 text-[#C5A572] mx-auto mb-3" />
          </motion.div>
          <h1 className="text-2xl font-bold text-[#E8E8ED]">Agent Created</h1>
          <p className="text-xs text-[#8B8B96] mt-1">Copy this token now. You won't see it again.</p>
        </motion.div>

        <motion.div variants={fadeUp} className="bg-[#12121a] border border-[#C5A572]/20 rounded-xl p-6 space-y-4">
          {/* Token display */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-2">Delegation Token</p>
            <div className="relative">
              <pre className="bg-[#0a0a0f] rounded-lg p-4 text-xs text-[#C5A572] font-mono break-all select-all overflow-x-auto max-h-32">
                {token}
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-2 rounded-lg bg-[#12121a] border border-white/[.07] hover:border-[#C5A572]/40 transition-colors"
              >
                {copied
                  ? <CheckCircle className="w-4 h-4 text-[#34D399]" />
                  : <Copy className="w-4 h-4 text-[#8B8B96]" />
                }
              </button>
            </div>
          </div>

          {/* Agent details */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            {[
              ['Agent', name],
              ['Template', template.label],
              ['Max per action', template.maxCost ? `$${template.maxCost.toLocaleString()}` : 'Read-only'],
              ['Expires', '30 days'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-0.5">{label}</p>
                <p className="text-sm text-[#E8E8ED]">{value}</p>
              </div>
            ))}
          </div>

          {/* Try it */}
          <div className="pt-2 border-t border-white/[.07]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-2">Try It</p>
            <div className="bg-[#0a0a0f] rounded-lg p-3">
              <pre className="text-xs text-[#8B8B96] font-mono whitespace-pre-wrap break-all">
{`curl -X POST https://control.kanoniv.com/proxy/quickbooks/default/v3/company/123/bill \\
  -H "Authorization: Bearer ${token.slice(0, 20)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"TotalAmt": 100}'`}
              </pre>
            </div>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-6 flex gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex-1 bg-[#C5A572] hover:bg-[#D4BC94] text-[#0a0a0f] font-bold text-sm rounded-lg px-4 py-3 transition-colors flex items-center justify-center gap-2"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setToken(null); setName(''); }}
            className="bg-white/[.02] border border-white/[.07] text-[#8B8B96] hover:text-[#E8E8ED] hover:bg-white/[.05] rounded-lg px-4 py-3 text-sm transition-colors"
          >
            Create Another
          </button>
        </motion.div>
      </motion.div>
    );
  }

  // Creation form
  return (
    <motion.div
      className="p-6 max-w-2xl mx-auto"
      initial="hidden" animate="show" variants={stagger}
    >
      <motion.div variants={fadeUp} className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Setup</p>
        <h1 className="text-2xl font-bold text-[#E8E8ED]">Create Agent</h1>
        <p className="text-xs text-[#8B8B96] mt-1">
          Pick a role template and name your agent. The delegation token defines what it can do.
        </p>
      </motion.div>

      <motion.div variants={fadeUp} className="bg-[#12121a] border border-white/[.07] rounded-xl p-6 space-y-5">
        {/* Name */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1.5 block">
            Agent Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. ap-clerk-1"
            className="w-full bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2.5 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/40 transition-colors"
          />
        </div>

        {/* Template picker */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-2 block">
            Role Template
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DELEGATION_TEMPLATES.filter((_, i) => i > 0).map((t, i) => {
              const idx = i + 1;
              const isSelected = templateIdx === idx;
              return (
                <button
                  key={t.label}
                  onClick={() => setTemplateIdx(idx)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-[#C5A572]/40 bg-[#C5A572]/5'
                      : 'border-white/[.07] bg-[#0a0a0f] hover:border-white/[.15]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#E8E8ED]">{t.label}</span>
                    {t.maxCost !== undefined && t.maxCost > 0 && (
                      <span className="text-xs font-mono tabular-nums text-[#C5A572]">
                        ${t.maxCost.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#55555F] mt-0.5">{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected template details */}
        <div className="bg-[#0a0a0f] rounded-lg p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1.5">Permissions</p>
          <div className="flex flex-wrap gap-1.5">
            {template.scopes.map(scope => (
              <span key={scope} className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-blue-500/15 text-blue-400 border-blue-500/20">
                {scope}
              </span>
            ))}
          </div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-[#F87171] flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </motion.div>
        )}

        <button
          onClick={handleCreate}
          className="w-full bg-[#C5A572] hover:bg-[#D4BC94] text-[#0a0a0f] font-bold text-sm rounded-lg px-4 py-3 transition-colors flex items-center justify-center gap-2"
        >
          <Shield className="w-4 h-4" /> Create Agent & Generate Token
        </button>
      </motion.div>
    </motion.div>
  );
};
