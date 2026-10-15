/** Signup page with password requirements shown up front. */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { useSession } from '../hooks/useSession';

export function SignupPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    if (password !== confirm) {
      setFieldErrors({ confirm: 'Passwords do not match.' });
      setBusy(false);
      return;
    }
    try {
      await api('/auth/signup', { method: 'POST', body: { email, password } });
      // Navigate before refreshing: once the session resolves, the
      // RedirectIfAuthed wrapper would otherwise bounce us to /today.
      navigate('/onboarding', { replace: true });
      await refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.field) setFieldErrors({ [err.field]: err.message });
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
          <h1 className="text-2xl font-bold text-stone-900">{t('action.sign_up')}</h1>
          <p className="text-sm text-stone-500">{t('auth.verify_notice')}</p>
        </div>
        <form onSubmit={onSubmit} className="card space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="su-email">
              {t('auth.email')}
            </label>
            <input
              id="su-email"
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
            />
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>
          <div>
            <label className="label" htmlFor="su-password">
              {t('auth.password')}
            </label>
            <input
              id="su-password"
              type="password"
              required
              minLength={10}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
            />
            <p className="hint">10+ characters with upper, lower and a number.</p>
            {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
          </div>
          <div>
            <label className="label" htmlFor="su-confirm">
              {t('auth.confirm_password')}
            </label>
            <input
              id="su-confirm"
              type="password"
              required
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={!!fieldErrors.confirm}
            />
            {fieldErrors.confirm && <p className="field-error">{fieldErrors.confirm}</p>}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t('state.loading') : t('action.sign_up')}
          </button>
          <p className="text-center text-sm text-stone-600">
            {t('auth.have_account')}{' '}
            <Link to="/login" className="font-medium text-brand-700 hover:underline">
              {t('action.sign_in')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
