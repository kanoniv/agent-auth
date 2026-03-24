import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, ExternalLink, AlertTriangle, Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const } },
};

export const ConnectPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { cpApiUrl, jwt } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const success = searchParams.get('success') === 'true';
  const returnedClientId = searchParams.get('client_id');

  // Fetch or create client on mount
  useEffect(() => {
    if (success && returnedClientId) {
      setClientId(returnedClientId);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${cpApiUrl}/v1/clients`, {
          headers: { 'Authorization': `Bearer ${jwt}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.clients?.length > 0) {
          setClientId(data.clients[0].id);
        } else {
          // Auto-create first client
          const createResp = await fetch(`${cpApiUrl}/v1/clients`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'My Firm' }),
          });
          if (createResp.ok) {
            const client = await createResp.json();
            if (!cancelled) setClientId(client.id);
          }
        }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [cpApiUrl, jwt, success, returnedClientId]);

  const handleConnect = () => {
    if (!clientId) return;
    setLoading(true);
    // Redirect to CP API OAuth endpoint - this will redirect to Intuit
    window.location.href = `${cpApiUrl}/v1/oauth/quickbooks/connect/${clientId}`;
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
        <motion.div
          className="w-full max-w-sm text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
          >
            <CheckCircle className="w-12 h-12 text-[#34D399] mx-auto mb-4" />
          </motion.div>
          <h1 className="text-xl font-bold text-[#E8E8ED] mb-2">QuickBooks Connected</h1>
          <p className="text-sm text-[#8B8B96] mb-6">Your accounting data is now accessible to authorized agents</p>
          <button
            onClick={() => navigate('/agents/new')}
            className="bg-[#C5A572] hover:bg-[#D4BC94] text-[#0a0a0f] font-bold text-sm rounded-lg px-6 py-3 transition-colors"
          >
            Create Your First Agent
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      className="p-6 max-w-2xl mx-auto"
      initial="hidden" animate="show" variants={stagger}
    >
      <motion.div variants={fadeUp} className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1">Setup</p>
        <h1 className="text-2xl font-bold text-[#E8E8ED]">Connect QuickBooks</h1>
        <p className="text-xs text-[#8B8B96] mt-1">
          Link your QuickBooks Online account to enable AI agent authorization
        </p>
      </motion.div>

      <motion.div variants={fadeUp} className="bg-[#12121a] border border-white/[.07] rounded-xl p-6 space-y-6">
        {/* What happens */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#55555F]">What this does</p>
          <div className="space-y-2">
            {[
              'Connects your QuickBooks Online company to Kanoniv',
              'Enables AI agents to read and write financial data through the proxy',
              'All agent actions are authorized by delegation tokens you control',
              'Every action is logged with a signed audit trail',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-[#34D399] mt-0.5 flex-shrink-0" />
                <span className="text-sm text-[#E8E8ED]">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Connect button */}
        <div className="pt-2">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-[#F87171] flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
            </motion.div>
          )}

          <button
            onClick={handleConnect}
            disabled={loading || !clientId}
            className="w-full bg-[#2CA01C] hover:bg-[#38B22A] text-white font-bold text-sm rounded-lg px-6 py-3.5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Building2 className="w-5 h-5" />
            {loading ? 'Redirecting to Intuit...' : 'Connect QuickBooks Online'}
            <ExternalLink className="w-4 h-4" />
          </button>
          <p className="text-[10px] text-[#55555F] text-center mt-2">
            You'll be redirected to Intuit to authorize access
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};
