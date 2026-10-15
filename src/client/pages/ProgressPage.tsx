/** Progress page: weigh-in, weight trend, consistency, PRs, goal review. */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { ErrorState, LoadingState } from '../components/ui-states';

type Summary = {
  completedSessions: number;
  missedSessions: number;
  weight: {
    latest: number | null;
    changeSincePrevious: number | null;
    movingAverage3: number[];
    dataPoints: number;
    trendNoteKey: string;
  };
  personalRecords: Array<{
    name_en: string;
    record_kind: string;
    value: number;
    unit: string;
    achieved_date: string;
  }>;
  noticeKey: string;
};

export function ProgressPage() {
  const { t, formatNumber, formatDate, locale } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [weighInDone, setWeighInDone] = useState(false);
  const [goalReview, setGoalReview] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api<Summary>('/progress/summary'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitWeighIn(e: FormEvent) {
    e.preventDefault();
    if (!weight) return;
    try {
      await api('/progress/weigh-ins', {
        method: 'POST',
        body: {
          entryDate: new Date().toISOString().slice(0, 10),
          weightKg: Number(weight),
          conditions: { afterToilet: true, beforeBreakfast: true, similarTime: true },
          skipped: false,
        },
      });
      setWeighInDone(true);
      setWeight('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  async function runGoalReview() {
    try {
      const res = await api<{ summary: Record<string, unknown> }>('/progress/goal-review', {
        method: 'POST',
        body: {},
      });
      setGoalReview(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  if (error && !summary) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!summary) return <LoadingState />;

  return (
    <div className="space-y-6" data-testid="progress-page">
      <h1 className="text-2xl font-bold text-stone-900">{t('progress.title')}</h1>

      <section className="card" aria-labelledby="weighin-heading">
        <h2 id="weighin-heading" className="font-semibold text-stone-900">
          {t('progress.weigh_in')}
        </h2>
        <p className="mt-1 text-sm text-stone-500">{t('progress.weigh_in_hint')}</p>
        {weighInDone ? (
          <p className="mt-3 text-sm text-emerald-800" role="status">
            ✓ Saved
          </p>
        ) : (
          <form onSubmit={submitWeighIn} className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="weight-input">
                {t('progress.weight')} (kg)
              </label>
              <input
                id="weight-input"
                type="number"
                step="0.1"
                min={20}
                max={400}
                required
                className="input !w-32"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                data-testid="weight-input"
              />
            </div>
            <button type="submit" className="btn-primary" data-testid="save-weighin">
              {t('action.save')}
            </button>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="trend-heading">
        <h2 id="trend-heading" className="font-semibold text-stone-900">
          {t('progress.trend')}
        </h2>
        {summary.weight.dataPoints === 0 ? (
          <p className="mt-2 text-sm text-stone-500">{t('state.empty_title')}</p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-bold text-stone-900" data-testid="weight-latest">
              {summary.weight.latest != null
                ? `${formatNumber(summary.weight.latest, { maximumFractionDigits: 1 })} kg`
                : '—'}
              {summary.weight.changeSincePrevious != null && (
                <span className="ml-2 text-sm font-medium text-stone-500">
                  {summary.weight.changeSincePrevious > 0 ? '+' : ''}
                  {formatNumber(summary.weight.changeSincePrevious)} kg
                </span>
              )}
            </p>
            <p className="mt-2 text-xs text-stone-500">
              {t(summary.weight.trendNoteKey as Parameters<typeof t>[0])}
            </p>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="consistency-heading">
        <h2 id="consistency-heading" className="font-semibold text-stone-900">
          {t('progress.consistency')}
        </h2>
        <p className="mt-2 text-3xl font-bold text-stone-900" data-testid="consistency-value">
          {formatNumber(summary.completedSessions)} ✓
          <span className="ml-2 text-base font-normal text-stone-500">
            / {formatNumber(summary.missedSessions)} missed
          </span>
        </p>
      </section>

      {summary.personalRecords.length > 0 && (
        <section className="card" aria-labelledby="pr-heading">
          <h2 id="pr-heading" className="font-semibold text-stone-900">
            {t('progress.personal_records')}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.personalRecords.map((pr, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{pr.name_en}</span>
                <span className="font-medium">
                  {formatNumber(pr.value)} {pr.unit} · {formatDate(pr.achieved_date)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="goal-review-heading">
        <h2 id="goal-review-heading" className="font-semibold text-stone-900">
          {t('progress.goal_review')}
        </h2>
        <button type="button" className="btn-secondary mt-3" onClick={() => void runGoalReview()}>
          {t('action.confirm')}
        </button>
        {goalReview && (
          <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm" data-testid="goal-review-result">
            <p>
              {t('progress.consistency')}: {String(goalReview.consistencyPercent ?? '—')}%
            </p>
            <p className="mt-1 text-stone-500">{t('progress.goal_review_interpretation')}</p>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-400" lang={locale}>
          {t(summary.noticeKey as Parameters<typeof t>[0])}
        </p>
      </section>
    </div>
  );
}
