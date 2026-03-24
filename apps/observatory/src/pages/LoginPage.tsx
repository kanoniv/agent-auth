import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, ArrowRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await login(email, password);
    if (result.ok) {
      navigate('/');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <Shield className="w-8 h-8 text-[#C5A572]" />
          <span className="text-xl font-bold text-[#E8E8ED]">Kanoniv</span>
        </div>

        {/* Card */}
        <div className="bg-[#12121a] border border-white/[.07] rounded-xl p-6">
          <h1 className="text-lg font-bold text-[#E8E8ED] mb-1">Sign in</h1>
          <p className="text-xs text-[#55555F] mb-6">Authorization infrastructure for AI agents</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2.5 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/40 transition-colors"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2.5 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/40 transition-colors"
              />
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
              type="submit"
              disabled={loading}
              className="w-full bg-[#C5A572] hover:bg-[#D4BC94] text-[#0a0a0f] font-bold text-sm rounded-lg px-4 py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? 'Signing in...' : 'Sign in'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>

        <p className="text-xs text-[#55555F] text-center mt-4">
          No account?{' '}
          <Link to="/signup" className="text-[#C5A572] hover:text-[#D4BC94] transition-colors">
            Sign up
          </Link>
        </p>
      </motion.div>
    </div>
  );
};
