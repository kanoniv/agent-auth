import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await login(email, password, tenantId);
    if (result.ok) {
      navigate('/');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-8 h-8 rounded-md bg-[#B08D3E] flex items-center justify-center">
            <span className="font-display text-white text-sm font-bold">K</span>
          </div>
          <span className="font-display text-xl text-[#1A1814]">Kanoniv</span>
        </div>

        {/* Card */}
        <div className="bg-white border border-[#E8E5DE] rounded-lg p-6 shadow-[0_2px_8px_rgba(26,24,20,0.06)]">
          <h1 className="font-display text-lg text-[#1A1814] mb-1">Sign in</h1>
          <p className="text-xs text-[#6B6760] mb-6">Authorization infrastructure for AI agents</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#9C978E] mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] focus:ring-2 focus:ring-[#FAF6ED] transition-colors"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#9C978E] mb-1.5 block">
                Company ID
              </label>
              <input
                type="text"
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                required
                className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] focus:ring-2 focus:ring-[#FAF6ED] transition-colors"
                placeholder="your-company-slug"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#9C978E] mb-1.5 block">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] focus:ring-2 focus:ring-[#FAF6ED] transition-colors"
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="p-3 rounded-lg bg-[#FDF0F0] border border-[#F0C6C6] text-sm text-[#C23A3A] flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#B08D3E] hover:bg-[#C5A572] text-white font-semibold text-sm rounded-lg px-4 py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? 'Signing in...' : 'Sign in'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>

        <p className="text-xs text-[#6B6760] text-center mt-4">
          No account?{' '}
          <Link to="/signup" className="text-[#B08D3E] hover:text-[#C5A572] transition-colors">
            Sign up
          </Link>
        </p>
      </motion.div>
    </div>
  );
};
