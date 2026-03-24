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
            <div className="w-12 h-12 rounded-full bg-[#FAF6ED] border border-[#E8DCC4] flex items-center justify-center mx-auto mb-3">
              <Shield className="w-6 h-6 text-[#B08D3E]" />
            </div>
          </motion.div>
          <h1 className="text-2xl font-display font-bold text-[#1A1814]">Agent Created</h1>
          <p className="text-sm text-[#6B6760] mt-1">Copy this token now. You won't see it again.</p>
        </motion.div>

        {/* One-time warning */}
        <motion.div variants={fadeUp} className="mb-4 p-3 rounded-lg bg-[#FFF8E8] border border-[#F0DDB0] text-sm text-[#B8860B] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          This token is displayed only once. Store it securely before leaving this page.
        </motion.div>

        <motion.div variants={fadeUp} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-6 space-y-4">
          {/* Token display */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-2">Delegation Token</p>
            <div className="relative">
              <pre className="bg-[#FAFAF8] border border-[#F0EDE6] rounded-lg p-4 text-xs text-[#1A1814] font-mono break-all select-all overflow-x-auto max-h-32">
                {token}
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-2 rounded-md bg-[#FAF6ED] border border-[#E8DCC4] hover:bg-[#F5EFE0] transition-colors"
              >
                {copied
                  ? <CheckCircle className="w-4 h-4 text-[#1A7A42]" />
                  : <Copy className="w-4 h-4 text-[#B08D3E]" />
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
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-0.5">{label}</p>
                <p className="text-sm text-[#1A1814]">{value}</p>
              </div>
            ))}
          </div>

          {/* Try it - dark code block */}
          <div className="pt-2 border-t border-[#F0EDE6]">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-2">Try It</p>
            <div className="bg-[#1A1814] rounded-lg p-3">
              <pre className="text-xs text-[#E8E5DE] font-mono whitespace-pre-wrap break-all">
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
            className="flex-1 bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-4 py-3 transition-colors flex items-center justify-center gap-2"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setToken(null); setName(''); }}
            className="bg-white border border-[#E8E5DE] text-[#6B6760] hover:bg-[#F7F6F3] rounded-md px-4 py-3 text-sm font-medium transition-colors"
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
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Setup</p>
        <h1 className="text-2xl font-display font-bold text-[#1A1814]">Create Agent</h1>
        <p className="text-sm text-[#6B6760] mt-1">
          Pick a role template and name your agent. The delegation token defines what it can do.
        </p>
      </motion.div>

      <motion.div variants={fadeUp} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-6 space-y-5">
        {/* Name */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5 block">
            Agent Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. ap-clerk-1"
            className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-md px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] transition-colors"
          />
        </div>

        {/* Template picker */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-2 block">
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
                      ? 'border-[#B08D3E] bg-[#FAF6ED]'
                      : 'border-[#E8E5DE] bg-white hover:border-[#D0CDC6]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#1A1814]">{t.label}</span>
                    {t.maxCost !== undefined && t.maxCost > 0 && (
                      <span className="text-xs font-mono font-data text-[#B08D3E]">
                        ${t.maxCost.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#9C978E] mt-0.5">{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected template details */}
        <div className="bg-[#FAFAF8] border border-[#F0EDE6] rounded-lg p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1.5">Permissions</p>
          <div className="flex flex-wrap gap-1.5">
            {template.scopes.map(scope => (
              <span key={scope} className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-[#EDF4FB] text-[#2E6DA4] border-[#B8D4F0]">
                {scope}
              </span>
            ))}
          </div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-lg bg-[#FDF0F0] border border-[#F0C6C6] text-sm text-[#C23A3A] flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </motion.div>
        )}

        <button
          onClick={handleCreate}
          className="w-full bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-4 py-3 transition-colors flex items-center justify-center gap-2"
        >
          <Shield className="w-4 h-4" /> Create Agent & Generate Token
        </button>
      </motion.div>
    </motion.div>
  );
};
