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
  const clientParam = searchParams.get('client');

  // Fetch or create client on mount
  useEffect(() => {
    // Use client_id from success callback, or client param from navigation, or fetch first client
    if (success && returnedClientId) {
      setClientId(returnedClientId);
      return;
    }
    if (clientParam) {
      setClientId(clientParam);
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
          if (!cancelled) setClientId(data.clients[0].id);
        }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [cpApiUrl, jwt, success, returnedClientId, clientParam]);

  const handleConnect = () => {
    if (!clientId || !jwt) return;
    setLoading(true);
    // Redirect browser to CP API OAuth endpoint with JWT in query param.
    // NOTE: JWT in URL is a security tradeoff - visible in browser history and
    // server logs. A short-lived nonce exchange would be better but requires
    // an additional endpoint. Acceptable for now since the JWT has limited scope.
    window.location.href = `${cpApiUrl}/v1/oauth/quickbooks/connect/${clientId}?token=${jwt}`;
  };

  if (success) {
    return (
      <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
        <motion.div
          className="w-full max-w-sm text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
            >
              <div className="w-14 h-14 rounded-full bg-[#EDFAF2] border border-[#C6F0D6] flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-7 h-7 text-[#1A7A42]" />
              </div>
            </motion.div>
            <h1 className="text-xl font-display font-bold text-[#1A1814] mb-2">QuickBooks Connected</h1>
            <p className="text-sm text-[#6B6760] mb-6">Your accounting data is now accessible to authorized agents</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => navigate(returnedClientId ? `/clients/${returnedClientId}` : '/clients')}
                className="bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-md px-6 py-3 transition-colors"
              >
                View Client Details
              </button>
              <button
                onClick={() => navigate(`/agents/new${returnedClientId ? `?client_id=${returnedClientId}` : ''}`)}
                className="text-sm text-[#B08D3E] hover:text-[#C5A572] font-medium transition-colors"
              >
                Assign an agent to this client
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-lg"
        initial="hidden" animate="show" variants={stagger}
      >
        <motion.div variants={fadeUp} className="mb-8 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E] mb-1">Setup</p>
          <h1 className="text-2xl font-display font-bold text-[#1A1814]">Connect QuickBooks</h1>
          <p className="text-sm text-[#6B6760] mt-1">
            Link your QuickBooks Online account to enable AI agent authorization
          </p>
        </motion.div>

        <motion.div variants={fadeUp} className="bg-white border border-[#E8E5DE] rounded-lg shadow-[0_1px_2px_rgba(26,24,20,0.04)] p-6 space-y-6">
          {/* What happens */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">What this does</p>
            <div className="space-y-2.5">
              {[
                'Connects your QuickBooks Online company to Kanoniv',
                'Enables AI agents to read and write financial data through the proxy',
                'All agent actions are authorized by delegation tokens you control',
                'Every action is logged with a signed audit trail',
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle className="w-4 h-4 text-[#1A7A42] mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-[#1A1814]">{text}</span>
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
                className="mb-4 p-3 rounded-lg bg-[#FDF0F0] border border-[#F0C6C6] text-sm text-[#C23A3A] flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </motion.div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading || !clientId}
              className="w-full bg-[#2CA01C] hover:bg-[#38B22A] text-white font-semibold text-sm rounded-md px-6 py-3.5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Building2 className="w-5 h-5" />
              {loading ? 'Redirecting to Intuit...' : 'Connect QuickBooks Online'}
              <ExternalLink className="w-4 h-4" />
            </button>
            <p className="text-[10px] text-[#9C978E] text-center mt-2">
              You'll be redirected to Intuit to authorize access
            </p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};
