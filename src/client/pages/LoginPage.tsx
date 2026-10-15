/** Login page with friendly validation and OAuth options. */

import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { useSession } from '../hooks/useSession';
import type { SessionUser } from '../../shared/contracts';

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/today';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      await api<{ user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      navigate(from, { replace: true });
      await refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.field === 'email' || err.field === 'password') setFieldError(err.message);
        else setError(err.message);
      } else {
        setError(t('error.generic'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-white">
            T
          </span>
          <h1 className="mt-3 text-2xl font-bold text-stone-900">{t('action.sign_in')}</h1>
          <p className="text-sm text-stone-500">{t('app.tagline')}</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              {t('auth.email')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldError}
            />
            {fieldError && <p className="field-error">{fieldError}</p>}
          </div>
          <div>
            <label className="label" htmlFor="password">
              {t('auth.password')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t('state.loading') : t('action.sign_in')}
          </button>
          <div className="flex flex-col gap-2">
            <a href="/api/v1/auth/oauth/google/start" className="btn-secondary w-full">
              {t('auth.google')}
            </a>
            <a href="/api/v1/auth/oauth/apple/start" className="btn-secondary w-full">
              {t('auth.apple')}
            </a>
          </div>
          <div className="flex justify-between text-sm">
            <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
              {t('auth.forgot')}
            </Link>
            <Link to="/signup" className="font-medium text-brand-700 hover:underline">
              {t('auth.no_account')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
