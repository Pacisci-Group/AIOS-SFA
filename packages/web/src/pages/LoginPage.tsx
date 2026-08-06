import { FormEvent, useState } from 'react';
import { Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Shield size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">AgencyOps</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Operations Platform
            </p>
          </div>
        </div>

        <Card className="p-6 gap-4 border-border">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-foreground font-semibold text-base">Sign in</h2>

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-slate-400">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-input border-border"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-slate-400">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-input border-border"
              />
            </div>

            <Button
              type="submit"
              variant="brand"
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center pt-2">
              Use seed credentials from .env (SEED_AGENCY_OWNER_EMAIL)
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
