import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, ArrowRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { signup, loading } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '', company: '' });
  const [error, setError] = useState<string | null>(null);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await signup(form.email, form.password, form.first_name, form.last_name, form.company);
    if (result.ok) {
      navigate('/');
    } else {
      setError(result.error || 'Signup failed');
    }
  };

  const field = (label: string, key: string, type = 'text', placeholder = '') => (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-[#55555F] mb-1.5 block">{label}</label>
      <input
        type={type}
        value={form[key as keyof typeof form]}
        onChange={set(key)}
        required
        className="w-full bg-[#0a0a0f] border border-white/[.07] rounded-lg px-3 py-2.5 text-sm text-[#E8E8ED] focus:outline-none focus:border-[#C5A572]/40 transition-colors"
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }}
      >
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <Shield className="w-8 h-8 text-[#C5A572]" />
          <span className="text-xl font-bold text-[#E8E8ED]">Kanoniv</span>
        </div>

        <div className="bg-[#12121a] border border-white/[.07] rounded-xl p-6">
          <h1 className="text-lg font-bold text-[#E8E8ED] mb-1">Create account</h1>
          <p className="text-xs text-[#55555F] mb-6">Start governing your AI agents in minutes</p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field('First name', 'first_name', 'text', 'Jane')}
              {field('Last name', 'last_name', 'text', 'Smith')}
            </div>
            {field('Company', 'company', 'text', 'Acme Accounting')}
            {field('Email', 'email', 'email', 'jane@acme.com')}
            {field('Password', 'password', 'password')}

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
              {loading ? 'Creating account...' : 'Get started'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>

        <p className="text-xs text-[#55555F] text-center mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-[#C5A572] hover:text-[#D4BC94] transition-colors">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
};
