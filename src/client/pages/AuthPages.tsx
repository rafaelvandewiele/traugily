/** Email verification + password reset request/confirm pages. */

import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';

export function VerifyEmailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useState(() => {
    if (token) {
      api('/auth/verify-email', { method: 'POST', body: { token } })
        .then(() => setStatus('ok'))
        .catch((e: Error) => {
          setStatus('error');
          setMessage(e.message);
        });
    }
  });

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card text-center">
        <h1 className="text-xl font-bold text-stone-900">{t('auth.verify_notice')}</h1>
        {status === 'idle' && <p className="mt-2 text-sm text-stone-500">{t('state.loading')}</p>}
        {status === 'ok' && (
          <>
            <p className="mt-2 text-sm text-emerald-800">Email verified.</p>
            <Link to="/login" className="btn-primary mt-4 inline-flex">
              {t('action.sign_in')}
            </Link>
          </>
        )}
        {status === 'error' && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch {
      setError(t('error.generic'));
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card">
        <h1 className="text-xl font-bold text-stone-900">{t('auth.forgot')}</h1>
        {sent ? (
          <p className="mt-3 text-sm text-emerald-800">{t('auth.reset_sent')}</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            {error && (
              <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
            <div>
              <label className="label" htmlFor="fp-email">
                {t('auth.email')}
              </label>
              <input
                id="fp-email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              {t('action.confirm')}
            </button>
          </form>
        )}
        <p className="mt-4 text-sm">
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            {t('action.sign_in')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card">
        <h1 className="text-xl font-bold text-stone-900">{t('auth.password')}</h1>
        {done ? (
          <p className="mt-3 text-sm text-emerald-800">Password updated. Please sign in.</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            {error && (
              <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
            <div>
              <label className="label" htmlFor="rp-password">
                {t('auth.password')}
              </label>
              <input
                id="rp-password"
                type="password"
                required
                minLength={10}
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="rp-confirm">
                {t('auth.confirm_password')}
              </label>
              <input
                id="rp-confirm"
                type="password"
                required
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              {t('action.save')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
