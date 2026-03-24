import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, AlertTriangle } from 'lucide-react';
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
      <label className="text-[10px] font-bold uppercase tracking-widest text-[#9C978E] mb-1.5 block">
        {label}
      </label>
      <input
        type={type}
        value={form[key as keyof typeof form]}
        onChange={set(key)}
        required
        className="w-full bg-[#FAFAF8] border border-[#E8E5DE] rounded-lg px-3 py-2.5 text-sm text-[#1A1814] placeholder:text-[#9C978E] focus:outline-none focus:border-[#B08D3E] focus:ring-2 focus:ring-[#FAF6ED] transition-colors"
        placeholder={placeholder}
      />
    </div>
  );

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
          <h1 className="font-display text-lg text-[#1A1814] mb-1">Create account</h1>
          <p className="text-xs text-[#6B6760] mb-6">Start governing your AI agents in minutes</p>

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
              {loading ? 'Creating account...' : 'Get started'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>

        <p className="text-xs text-[#6B6760] text-center mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-[#B08D3E] hover:text-[#C5A572] transition-colors">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
};
