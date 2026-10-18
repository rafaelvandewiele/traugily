/** Account: profile, billing (Stripe), privacy/consents, export, deletion. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { useSession } from '../hooks/useSession';
import { ErrorState, LoadingState } from '../components/ui-states';
import type { Locale } from '../../shared/contracts';

type BillingStatus = {
  entitlement: { plan: string; status: string; valid_until: string | null } | null;
  subscription: {
    status: string;
    currency: string;
    nextBillAt: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  invoices: Array<{
    stripe_invoice_id: string;
    amount_due: number;
    currency: string;
    status: string;
    hosted_invoice_url: string | null;
    created_at: string;
  }>;
  currency: string;
  priceNote: string;
  trialDays: number;
  portalAvailable: boolean;
};

type Consent = { consent_key: string; granted: number; version: string };

export function AccountPage() {
  const { t, setLocale, formatDate } = useI18n();
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [passwordCurrent, setPasswordCurrent] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([
        api<BillingStatus>('/billing/status'),
        api<{ consents: Consent[] }>('/account/consents'),
      ]);
      setBilling(b);
      setConsents(c.consents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [t]);

  useEffect(() => {
    void load();
    if (params.get('checkout') === 'success') setNotice(t('billing.checkout_success'));
    if (params.get('checkout') === 'cancelled') setNotice(t('billing.checkout_cancelled'));
  }, [load, params, t]);

  async function startCheckout() {
    setBusy(true);
    try {
      const res = await api<{ url: string }>('/billing/checkout', { method: 'POST' });
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    try {
      const res = await api<{ url: string }>('/billing/portal', { method: 'POST' });
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
      setBusy(false);
    }
  }

  async function toggleConsent(key: string, granted: boolean, version: string) {
    try {
      await api('/account/consents', {
        method: 'PUT',
        body: { consentKey: key, granted, version },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  async function exportData() {
    try {
      const res = await api<Record<string, unknown>>('/account/export');
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `traugily-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  async function deleteAccount() {
    setBusy(true);
    try {
      await api('/account', { method: 'DELETE', body: { confirmEmail: deleteEmail } });
      await signOut();
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
      setBusy(false);
    }
  }

  async function changePassword() {
    if (passwordNew !== passwordConfirm) {
      setFieldError(t('error.validation'));
      return;
    }
    if (passwordNew.length < 10) {
      setFieldError(t('account.password_requirements'));
      return;
    }
    setBusy(true);
    setFieldError(null);
    try {
      await api('/account/password', {
        method: 'POST',
        body: { currentPassword: passwordCurrent, newPassword: passwordNew },
      });
      setPasswordCurrent('');
      setPasswordNew('');
      setPasswordConfirm('');
      setFieldError(null);
      setNotice(t('account.password_changed'));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 400) {
        setFieldError(err.message);
      } else {
        setError(err instanceof Error ? err.message : t('error.generic'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !billing) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!billing || !user) return <LoadingState />;

  const isPremium =
    billing.entitlement?.plan === 'premium' || billing.entitlement?.status === 'active';

  return (
    <div className="space-y-6" data-testid="account-page">
      <h1 className="text-2xl font-bold text-stone-900">{t('account.title')}</h1>

      {notice && (
        <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="card" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="font-semibold text-stone-900">
          {t('account.profile')}
        </h2>
        <p className="mt-2 text-sm text-stone-600">{user.email}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="acc-locale">
              {t('account.language')}
            </label>
            <select
              id="acc-locale"
              className="input"
              value={user.locale}
              onChange={(e) => {
                const next = e.target.value as Locale;
                setLocale(next);
                void api('/me/preferences', { method: 'PUT', body: { locale: next } }).catch(
                  () => undefined,
                );
              }}
            >
              <option value="en">English</option>
              <option value="nl">Nederlands</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="acc-units">
              {t('account.units')}
            </label>
            <select
              id="acc-units"
              className="input"
              defaultValue={user.unitSystem}
              onChange={(e) =>
                void api('/me/preferences', {
                  method: 'PUT',
                  body: { unitSystem: e.target.value },
                }).catch(() => undefined)
              }
            >
              <option value="metric">kg / cm</option>
              <option value="imperial">lb / in</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="change-password-heading">
        <h2 id="change-password-heading" className="font-semibold text-stone-900">
          {t('account.change_password_heading')}
        </h2>
        <p className="mt-2 text-sm text-stone-600">{t('account.change_password')}</p>

        <form
          className="card space-y-3 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void changePassword();
          }}
        >
          <div className="space-y-2">
            <label className="label" htmlFor="pw-current">
              {t('account.password_current')}
            </label>
            <input
              id="pw-current"
              type="password"
              className="input"
              value={passwordCurrent}
              onChange={(e) => setPasswordCurrent(e.target.value)}
              placeholder={t('account.password_current')}
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-2">
            <label className="label" htmlFor="pw-new">
              {t('account.password_new')}
            </label>
            <input
              id="pw-new"
              type="password"
              className="input"
              value={passwordNew}
              onChange={(e) => setPasswordNew(e.target.value)}
              placeholder={t('account.password_new')}
              autoComplete="new-password"
            />
            {fieldError && (
              <p className="text-xs text-red-600" role="alert">
                {fieldError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="label" htmlFor="pw-confirm">
              {t('account.password_confirm')}
            </label>
            <input
              id="pw-confirm"
              type="password"
              className="input"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder={t('account.password_confirm')}
              autoComplete="new-password"
            />
          </div>

          <div className="text-xs text-stone-500">
            {t('account.password_requirements')}
          </div>

          <button
            type="submit"
            className="btn-primary mt-3"
            disabled={
              !passwordCurrent || !passwordNew || !passwordConfirm ||
              passwordNew.length < 10 || passwordNew !== passwordConfirm
            }
          >
            {t('action.change_password')}
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="billing-heading" data-testid="billing-section">
        <h2 id="billing-heading" className="font-semibold text-stone-900">
          {t('account.billing')}
        </h2>
        <p className="mt-2 text-sm">
          {t('account.entitlement')}:{' '}
          <span className="font-semibold" data-testid="entitlement-plan">
            {isPremium ? t('account.plan.premium') : t('account.plan.free')}
          </span>
          {billing.subscription && (
            <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs">
              {billing.subscription.status}
            </span>
          )}
        </p>
        {billing.subscription?.nextBillAt && (
          <p className="text-sm text-stone-500">
            {t('account.next_bill')}: {formatDate(billing.subscription.nextBillAt.slice(0, 10))}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!isPremium && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void startCheckout()}
              data-testid="subscribe-btn"
            >
              {t('account.subscribe')}
            </button>
          )}
          {billing.portalAvailable && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void openPortal()}
            >
              {t('account.manage_billing')}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-stone-500">{billing.priceNote}</p>
        <p className="text-xs text-stone-500">{t('account.cancel_terms')}</p>
        {billing.invoices.length > 0 && (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {billing.invoices.map((inv) => (
              <li key={inv.stripe_invoice_id} className="flex items-center justify-between py-2">
                <span>{formatDate(inv.created_at.slice(0, 10))}</span>
                <span className="text-stone-600">
                  {(inv.amount_due / 100).toFixed(2)} {inv.currency.toUpperCase()}
                </span>
                {inv.hosted_invoice_url && (
                  <a
                    href={inv.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-700 underline"
                  >
                    {t('action.download')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="font-semibold text-stone-900">
          {t('account.privacy')}
        </h2>
        <div className="mt-3 space-y-3">
          {(
            [
              ['marketing_email', t('account.marketing_consent')],
              ['progress_photos', t('account.photo_consent')],
              ['ai_processing', t('account.ai_consent')],
            ] as const
          ).map(([key, label]) => {
            const consent = consents.find((c) => c.consent_key === key);
            return (
              <label key={key} className="flex items-center justify-between gap-3 text-sm">
                <span>{label}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={!!consent?.granted}
                  onChange={(e) =>
                    void toggleConsent(key, e.target.checked, consent?.version ?? '2026-01')
                  }
                />
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void exportData()}>
            {t('account.export_data')}
          </button>
          <button type="button" className="btn-danger" onClick={() => setDeleteOpen(true)}>
            {t('account.delete_account')}
          </button>
        </div>
      </section>

      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('account.delete_account')}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <h2 className="font-semibold text-red-900">{t('account.delete_account')}</h2>
            <p className="mt-2 text-sm text-stone-600">{t('account.delete_confirm')}</p>
            <input
              type="email"
              className="input mt-2"
              value={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.value)}
              aria-label={t('account.delete_confirm')}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-danger flex-1"
                disabled={deleteEmail !== user.email || busy}
                onClick={() => void deleteAccount()}
                data-testid="confirm-delete"
              >
                {t('account.delete_account')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setDeleteOpen(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn-secondary w-full"
        onClick={async () => {
          await signOut();
          navigate('/login');
        }}
      >
        {t('account.sign_out')}
      </button>
    </div>
  );
}
