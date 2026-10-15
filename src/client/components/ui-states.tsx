/** Shared UI state components: loading, empty, error — consistent across flows. */

import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { useI18n } from '../i18n';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-16">
      <span
        className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700"
        aria-hidden
      />
      <p className="text-sm text-stone-500">{label ?? t('state.loading')}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="card flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-base font-semibold text-stone-800">{title ?? t('state.empty_title')}</p>
      {description && <p className="max-w-sm text-sm text-stone-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="card border-red-200 bg-red-50 py-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-700" aria-hidden />
      <p className="mt-3 text-base font-semibold text-red-900">{t('state.error_title')}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-red-800">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-4">
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('action.retry')}
        </button>
      )}
    </div>
  );
}

export function OfflineBadge({ status }: { status: 'local' | 'pending' | 'synced' | 'attention' }) {
  const { t } = useI18n();
  const map = {
    local: { label: t('state.saved_locally'), cls: 'bg-stone-100 text-stone-700' },
    pending: { label: t('state.waiting_to_sync'), cls: 'bg-amber-100 text-amber-900' },
    synced: { label: t('state.synced'), cls: 'bg-emerald-100 text-emerald-900' },
    attention: { label: t('state.sync_needs_attention'), cls: 'bg-red-100 text-red-900' },
  } as const;
  const entry = map[status];
  return (
    <span className={`badge ${entry.cls}`} role="status" data-testid={`sync-status-${status}`}>
      {status === 'attention' ? (
        <AlertTriangle className="h-3 w-3" aria-hidden />
      ) : status === 'synced' ? null : (
        <WifiOff className="h-3 w-3" aria-hidden />
      )}
      {entry.label}
    </span>
  );
}
