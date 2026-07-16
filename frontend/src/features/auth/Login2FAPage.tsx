import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setCsrfToken } from '@/lib/api/client';
import { loginVerify2fa } from './api';

/** Second login step for accounts with TOTP enabled. */
export default function Login2FAPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await loginVerify2fa(code);
      setCsrfToken(result.csrf_token);
      navigate(params.get('return') || '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Codice non valido.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-white p-8 shadow-card">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-6" />
        </div>
        <h1 className="text-xl font-bold text-navy">Verifica in due passaggi</h1>
        <p className="mb-6 mt-2 text-sm text-muted">
          Inserisci il codice a 6 cifre dalla tua app di autenticazione, oppure un codice di backup.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              Codice
            </label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Verifica in corso…' : 'Verifica'}
          </Button>
        </form>

        <Link to="/login" className="mt-5 inline-block text-sm text-primary">
          ← Torna al login
        </Link>
      </div>
    </div>
  );
}
