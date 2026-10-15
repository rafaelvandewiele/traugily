/** Today — the product home. The next meaningful action is obvious; start is ≤2 taps. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dumbbell, Play, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { useOnline } from '../hooks/useOnline';
import { EmptyState, ErrorState, LoadingState } from '../components/ui-states';
import { saveLocalWorkout } from '../offline/db';

type TodayData = {
  plan: { id: string; status: string; version: number } | null;
  nextSession: {
    id: string;
    scheduled_date: string;
    title_key: string;
    focus_key: string;
    duration_minutes: number;
    exercises: Array<{ id: string; exercise_id: string; name_en: string }>;
  } | null;
  activeWorkout: { id: string; started_at: string } | null;
  pendingProposalCount: number;
  unreadNotifications: number;
  nextAction: { kind: string; labelKey: string; sessionId?: string; workoutId?: string };
};

export function TodayPage() {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<TodayData>('/workouts/today'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startWorkout() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ workoutId: string; serverVersion: number; startedAt: string }>(
        '/workouts/start',
        { method: 'POST', body: { sessionId: data?.nextSession?.id } },
      );
      await saveLocalWorkout({
        workoutId: res.workoutId,
        serverVersion: res.serverVersion,
        startedAt: res.startedAt,
        pausedAt: null,
        pausedAccumulatedMs: 0,
        draftState: {},
        status: online ? 'pending' : 'local',
        updatedAt: new Date().toISOString(),
      });
      navigate(`/workout/${res.workoutId}`);
    } catch {
      setError(t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6" data-testid="today-page">
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{t('today.title')}</h1>
        <p className="text-sm text-stone-500">
          {formatDate(new Date().toISOString().slice(0, 10))}
        </p>
      </div>

      {/* Next action card — the single most important element on this screen. */}
      <section
        aria-labelledby="next-action-heading"
        className="card border-brand-200 bg-brand-50/60"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          {t('today.next_action')}
        </p>
        <h2 id="next-action-heading" className="mt-1 text-lg font-bold text-stone-900">
          {data.nextAction.kind === 'resume_workout'
            ? t('today.action.resume_workout')
            : data.nextAction.kind === 'start_workout'
              ? t('today.action.start_workout')
              : data.nextAction.kind === 'view_plan'
                ? t('today.action.view_plan')
                : t('today.action.start_onboarding')}
        </h2>

        {data.nextSession && (
          <div className="mt-2 space-y-1 text-sm text-stone-600">
            <p>
              {formatDate(data.nextSession.scheduled_date)} · {data.nextSession.duration_minutes}{' '}
              min
            </p>
            <p>
              {data.nextSession.exercises.length > 0
                ? data.nextSession.exercises.map((e) => e.name_en).join(' · ')
                : t('state.empty_title')}
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          {(data.nextAction.kind === 'start_workout' ||
            data.nextAction.kind === 'resume_workout') && (
            <button
              type="button"
              onClick={() => void startWorkout()}
              disabled={busy}
              className="btn-primary"
              data-testid="begin-workout"
            >
              <Play className="h-4 w-4" aria-hidden />
              {data.nextAction.kind === 'resume_workout'
                ? t('action.resume_workout')
                : t('action.begin_workout')}
            </button>
          )}
          {data.nextAction.kind === 'view_plan' && (
            <button type="button" onClick={() => navigate('/plan')} className="btn-secondary">
              {t('today.action.view_plan')}
            </button>
          )}
          {data.nextAction.kind === 'start_onboarding' && (
            <button type="button" onClick={() => navigate('/onboarding')} className="btn-primary">
              {t('today.action.start_onboarding')}
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {data.plan && (
          <div className="card">
            <p className="text-sm font-medium text-stone-500">{t('plan.title')}</p>
            <p className="mt-1 font-semibold text-stone-900">
              {t('plan.version', { version: data.plan.version })}
            </p>
            <button
              type="button"
              onClick={() => navigate('/plan')}
              className="btn-secondary mt-3 !min-h-9 text-sm"
            >
              {t('today.action.view_plan')}
            </button>
          </div>
        )}
        {data.pendingProposalCount > 0 && (
          <div className="card">
            <p className="flex items-center gap-2 font-semibold text-stone-900">
              <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
              {t('today.pending_proposals', { count: data.pendingProposalCount })}
            </p>
            <button
              type="button"
              onClick={() => navigate('/plan')}
              className="btn-secondary mt-3 !min-h-9 text-sm"
            >
              {t('action.accept')}
            </button>
          </div>
        )}
        {!data.plan && data.nextAction.kind === 'start_onboarding' && (
          <EmptyState
            title={t('today.start_onboarding')}
            description={t('onboarding.save_resume')}
            action={
              <button type="button" onClick={() => navigate('/onboarding')} className="btn-primary">
                <Dumbbell className="h-4 w-4" aria-hidden />
                {t('action.next')}
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
