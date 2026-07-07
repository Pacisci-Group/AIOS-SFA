import { FormEvent, useState } from 'react';
import { Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0F19] px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-lg bg-[#38BDF8] flex items-center justify-center">
            <Shield size={20} className="text-[#0B0F19]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#E2E8F0] tracking-tight">AgencyOps</h1>
            <p className="text-[10px] text-[#64748B] uppercase tracking-widest">
              Operations Platform
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-6 space-y-4"
          style={{ background: '#161F30', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <h2 className="text-[#E2E8F0] font-semibold text-base">Sign in</h2>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs text-[#94A3B8]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-[#E2E8F0] outline-none focus:ring-2 focus:ring-[#38BDF8]/40"
              style={{ background: '#1E2B44', border: '1px solid rgba(255,255,255,0.07)' }}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs text-[#94A3B8]">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-[#E2E8F0] outline-none focus:ring-2 focus:ring-[#38BDF8]/40"
              style={{ background: '#1E2B44', border: '1px solid rgba(255,255,255,0.07)' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #38BDF8, #0EA5E9)',
              color: '#0B0F19',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-[10px] text-[#64748B] text-center pt-2">
            Use seed credentials from .env (SEED_AGENCY_OWNER_EMAIL)
          </p>
        </form>
      </div>
    </div>
  );
}
