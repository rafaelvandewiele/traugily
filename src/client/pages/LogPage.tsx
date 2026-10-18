/** Log page: workout history + finish summary + plan-change prompt. */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { EmptyState, ErrorState, LoadingState } from '../components/ui-states';

type HistoryItem = {
  id: string;
  started_at: string;
  ended_at: string | null;
  state: string;
  duration_seconds: number | null;
  executed_sets: number;
};

export function LogPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const [params] = useSearchParams();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ workouts: HistoryItem[] }>('/workouts/history');
      // Defensive: never render malformed rows — a null row would crash the
      // whole list (and with it the page), showing the user a blank screen.
      setItems(
        (res.workouts ?? []).filter(
          (w): w is HistoryItem => !!w && typeof w.id === 'string' && typeof w.started_at === 'string',
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const raw = sessionStorage.getItem('tg_last_summary');
    if (raw && params.get('finished')) {
      try {
        setSummary(JSON.parse(raw) as Record<string, number | string>);
      } catch {
        // Corrupt cached summary — drop it instead of blanking the page.
      }
      sessionStorage.removeItem('tg_last_summary');
    }
  }, [load, params]);

  if (error && !items) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!items) return <LoadingState />;

  return (
    <div className="space-y-6" data-testid="log-page">
      <h1 className="text-2xl font-bold text-stone-900">{t('log.title')}</h1>

      {summary && (
        <section className="card border-emerald-200 bg-emerald-50" aria-live="polite">
          <h2 className="font-semibold text-emerald-950">{t('log.finish_summary')}</h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-emerald-800">{t('log.duration')}</dt>
              <dd className="font-medium text-emerald-950">
                {formatNumber(Math.round(Number(summary.durationSeconds ?? 0) / 60))} min
              </dd>
            </div>
            <div>
              <dt className="text-emerald-800">{t('log.total_rest')}</dt>
              <dd className="font-medium text-emerald-950">
                {formatNumber(Math.round(Number(summary.totalRestSeconds ?? 0) / 60))} min
              </dd>
            </div>
            <div>
              <dt className="text-emerald-800">{t('log.completed_exercises')}</dt>
              <dd className="font-medium text-emerald-950">
                {formatNumber(Number(summary.completedExercises ?? 0))}
              </dd>
            </div>
            <div>
              <dt className="text-emerald-800">{t('log.skipped_exercises')}</dt>
              <dd className="font-medium text-emerald-950">
                {formatNumber(Number(summary.skippedExercises ?? 0))}
              </dd>
            </div>
            <div>
              <dt className="text-emerald-800">{t('log.volume')}</dt>
              <dd className="font-medium text-emerald-950">
                {formatNumber(Number(summary.estimatedVolumeKg ?? 0))} kg
              </dd>
            </div>
            <div>
              <dt className="text-emerald-800">{t('log.calories')}</dt>
              <dd className="font-medium text-emerald-950">
                {formatNumber(Number(summary.estimatedCalories ?? 0))}
                <span className="ml-1 text-xs font-normal">(~)</span>
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-emerald-800">{t('log.calories_note')}</p>
        </section>
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 font-semibold text-stone-900">
          {t('log.history')}
        </h2>
        {items.length === 0 ? (
          <EmptyState
            title={t('log.no_history')}
            action={
              <Link to="/today" className="btn-primary mt-2">
                {t('today.title')}
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map((w) => (
              <li key={w.id} className="card flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-stone-900">
                    {formatDate(w.started_at.slice(0, 10))}
                  </p>
                  <p className="text-xs text-stone-500">
                    {w.executed_sets} sets
                    {w.duration_seconds ? ` · ${Math.round(w.duration_seconds / 60)} min` : ''}
                  </p>
                </div>
                <span className="badge bg-stone-100 text-stone-700">{w.state}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
