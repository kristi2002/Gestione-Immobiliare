import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setCsrfToken } from '@/lib/api/client';
import { login } from './api';

/** Public route — the React SPA's own login form (replaces legacy login.php). */
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await login(username, password);
      const returnTo = params.get('return') || '/';
      if (result.status === 'requires_2fa') {
        navigate(`/login/2fa?return=${encodeURIComponent(returnTo)}`);
        return;
      }
      setCsrfToken(result.csrf_token);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credenziali non valide.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <aside className="relative hidden flex-col items-center justify-center overflow-hidden bg-sidebar px-12 py-16 text-center text-white md:flex">
        <div className="flex size-[76px] items-center justify-center rounded-2xl border-2 border-white/85">
          <Home className="size-10" />
        </div>
        <p className="mt-6 text-[13px] font-semibold tracking-[0.28em] text-white/80">IMMOBILIARE</p>
        <p className="font-brand text-[52px] font-bold leading-none tracking-wide">ORLANDI</p>
        <p className="font-brand mt-6 max-w-md text-xl italic leading-relaxed text-white/85">
          &ldquo;Ogni proprietà racconta una storia. Noi la gestiamo con cura.&rdquo;
        </p>
        <p className="mt-8 text-[13px] tracking-wide text-white/60">Civitanova Marche · Italia</p>
      </aside>

      <main className="flex items-center justify-center bg-white px-6 py-16">
        <div className="w-full max-w-[400px]">
          <div className="mb-5 flex justify-center">
            <span className="flex size-[54px] items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Home className="size-7" />
            </span>
          </div>
          <h1 className="font-brand text-center text-[32px] font-bold text-navy">Accedi al Gestionale</h1>
          <p className="mb-8 mt-1.5 text-center text-sm text-muted">
            Inserisci le tue credenziali per continuare.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                Username
              </label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Il tuo username"
                autoFocus
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="La tua password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Accesso in corso…' : 'Accedi'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[12.5px] text-muted">
            © 2026 Immobiliare Orlandi · <a href="/privacy.php" className="text-primary">Privacy</a>
          </p>
        </div>
      </main>
    </div>
  );
}
