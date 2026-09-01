import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { useTenant } from '@/contexts/tenant-context';
import { BrandLockup } from '@/components/common/BrandMark';
import { ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/form';

export function LoginPage() {
  const { login } = useAuth();
  const { branding } = useTenant();
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
        <BrandLockup size="md" className="mb-8 justify-center" />

        <Card className="p-6 gap-4 border-border">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-foreground font-semibold text-base">Sign in</h2>

            <FormError>{error}</FormError>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">
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
              <Label htmlFor="password" className="text-xs text-muted-foreground">
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

            {/*
              A developer hint, so it is shown only on the platform host. On an
              agency's own domain this is a page their staff and no one else
              sees, and telling them to read our .env reads as a broken deploy.
            */}
            {branding.kind === 'platform' && (
              <p className="text-[10px] text-muted-foreground text-center pt-2">
                Use seed credentials from .env (SEED_AGENCY_OWNER_EMAIL)
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
