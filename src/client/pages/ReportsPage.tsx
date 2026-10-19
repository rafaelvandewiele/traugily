/** Reports page: period + detail pickers, 202 -> status polling -> PDF download. */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { EmptyState, ErrorState, LoadingState } from '../components/ui-states';
import type { Locale } from '../../shared/contracts';

type DetailLevel = 'summary' | 'standard' | 'detailed';
type ReportStatus = 'pending' | 'processing' | 'ready' | 'failed';

type StatusRow = {
  id: string;
  status: ReportStatus;
  file_size: number | null;
  error_message: string | null;
  attempts: number;
  completed_at: string | null;
};

type ExportRow = StatusRow & {
  period_start: string;
  period_end: string;
  detail_level: DetailLevel;
  report_locale: string;
  created_at: string;
};

function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: first.toISOString().slice(0, 10), end };
}

/**
 * Download via fetch+blob instead of a bare <a href> navigation: a plain link
 * navigations can land on the SPA shell (redirecting to /today) when the
 * response is not a file. Fetch lets us verify the response IS a PDF and
 * surface a real error otherwise.
 */
async function downloadReportFile(exportId: string): Promise<void> {
  const res = await fetch(`/api/v1/reports/${exportId}/download`, {
    credentials: 'same-origin',
    headers: { accept: 'application/pdf' },
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || !contentType.includes('application/pdf')) {
    const body = res.headers.get('content-type')?.includes('application/json')
      ? await res.json().catch(() => null)
      : null;
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? 'download_failed',
      body?.error?.message ?? 'The report file is not available yet. Check its status and retry.',
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `traugily-report-${exportId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState(defaultPeriod);
  const [detail, setDetail] = useState<DetailLevel>('standard');
  const [reportLocale, setReportLocale] = useState<Locale>(locale);
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [trackedStatus, setTrackedStatus] = useState<StatusRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await api<{ exports: ExportRow[] }>('/reports');
      setExports(res.exports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [t]);

  useEffect(() => { setReportLocale(locale); }, [locale]);
  useEffect(() => { void loadList(); }, [loadList]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const pollStatus = useCallback(async (exportId: string) => {
    try {
      const row = await api<StatusRow>(`/reports/${exportId}/status`);
      setTrackedStatus(row);
      if (row.status === 'ready' || row.status === 'failed') {
        stopPolling();
        await loadList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
      stopPolling();
    }
  }, [loadList, stopPolling, t]);

  useEffect(() => {
    if (!trackedId) return;
    stopPolling();
    void pollStatus(trackedId);
    pollRef.current = setInterval(() => { void pollStatus(trackedId); }, 2000);
    return stopPolling;
  }, [trackedId, pollStatus, stopPolling]);

  async function requestReport(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setError(null);
    if (!period.start || !period.end) { setFormError(t('reports.error_dates_required')); return; }
    if (period.end < period.start) { setFormError(t('reports.error_date_order')); return; }
    setBusy(true);
    try {
      const res = await api<{ exportId: string; status: ReportStatus }>('/reports', {
        method: 'POST',
        body: { periodStart: period.start, periodEnd: period.end, detailLevel: detail, reportLocale },
      });
      setTrackedId(res.exportId);
      setTrackedStatus({ id: res.exportId, status: res.status, file_size: null, error_message: null, attempts: 0, completed_at: null });
    } catch (err) {
      if (err instanceof ApiClientError) setFormError(err.message);
      else setFormError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (error && exports === null) return <ErrorState message={error} onRetry={() => void loadList()} />;

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{t('reports.title')}</h1>
        <p className="mt-1 text-sm text-stone-500">{t('reports.estimate_notice')}</p>
      </div>
      <section className="card" aria-labelledby="reports-new-heading">
        <h2 id="reports-new-heading" className="font-semibold text-stone-900">{t('action.generate_report')}</h2>
        <form onSubmit={requestReport} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="reports-start">{t('reports.start_date')}</label>
            <input id="reports-start" type="date" className="input" value={period.start} max={period.end || undefined} onChange={(ev) => setPeriod((p) => ({ ...p, start: ev.target.value }))} data-testid="reports-start" />
          </div>
          <div>
            <label className="label" htmlFor="reports-end">{t('reports.end_date')}</label>
            <input id="reports-end" type="date" className="input" value={period.end} min={period.start || undefined} onChange={(ev) => setPeriod((p) => ({ ...p, end: ev.target.value }))} data-testid="reports-end" />
          </div>
          <div>
            <label className="label" htmlFor="reports-detail">{t('reports.detail')}</label>
            <select id="reports-detail" className="input" value={detail} onChange={(ev) => setDetail(ev.target.value as DetailLevel)} data-testid="reports-detail">
              <option value="summary">{t('reports.detail.summary')}</option>
              <option value="standard">{t('reports.detail.standard')}</option>
              <option value="detailed">{t('reports.detail.detailed')}</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reports-locale">{t('reports.language')}</label>
            <select id="reports-locale" className="input" value={reportLocale} onChange={(ev) => setReportLocale(ev.target.value as Locale)} data-testid="reports-locale">
              <option value="en">English</option>
              <option value="nl">Nederlands</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy} data-testid="reports-generate">{busy ? t('state.loading') : t('action.generate_report')}</button>
            {formError && <p className="mt-2 text-sm text-red-800" role="alert">{formError}</p>}
          </div>
        </form>
        {trackedId && trackedStatus && (
          <div className="mt-4 rounded-xl bg-stone-50 p-3 text-sm" aria-live="polite" data-testid="reports-status">
            <p className="font-medium text-stone-900">{t(('reports.status.' + trackedStatus.status) as 'reports.status.pending')}</p>
            {trackedStatus.status === 'failed' && <p className="mt-1 text-red-800" role="alert">{trackedStatus.error_message ?? t('error.generic')}</p>}
            {trackedStatus.status === 'ready' ? (
              <button type="button" className="btn-secondary mt-2 inline-flex" data-testid="reports-download"
                onClick={() => void downloadFile(trackedId)}>{t('reports.download')}</button>
            ) : (trackedStatus.status === 'pending' || trackedStatus.status === 'processing') ? (
              <p className="mt-1 text-stone-500">{t('reports.polling')}</p>
            ) : null}
          </div>
        )}
      </section>
      <section aria-labelledby="reports-history-heading">
        <h2 id="reports-history-heading" className="mb-3 font-semibold text-stone-900">{t('reports.history')}</h2>
        {exports === null ? <LoadingState /> : exports.length === 0 ? (
          <EmptyState title={t('reports.empty')} description={t('reports.empty_hint')} />
        ) : (
          <ul className="space-y-2">
            {exports.map((row) => (
              <li key={row.id} className="card flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-stone-900">{row.period_start} - {row.period_end} - {row.detail_level} - {row.report_locale.toUpperCase()}</p>
                  <p className="text-xs text-stone-500">{t(('reports.status.' + row.status) as 'reports.status.pending')}{row.file_size ? ` - ${(row.file_size / 1024).toFixed(1)} KB` : ''}</p>
                  {row.status === 'failed' && row.error_message && <p className="mt-1 text-xs text-red-800" role="alert">{row.error_message}</p>}
                </div>
                {row.status === 'ready' ? (
                  <button type="button" className="btn-secondary shrink-0" onClick={() => void downloadFile(row.id)}>{t('action.download')}</button>
                ) : (
                  <button type="button" className="btn-secondary shrink-0" onClick={() => { setTrackedId(row.id); setTrackedStatus(row); }}>{t('action.retry')}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
