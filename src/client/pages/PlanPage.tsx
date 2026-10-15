/** Plan page: phases, weekly rhythm, plain-language explanations, proposals. */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { EmptyState, ErrorState, LoadingState } from '../components/ui-states';

type PlanData = {
  plan: {
    id: string;
    status: string;
    goalDurationWeeks: number;
    safetyAcknowledgedAt: string | null;
    activatedAt: string | null;
    version: number;
  };
  phases: Array<{
    phase_key: string;
    title_key: string;
    purpose: string;
    start_date: string;
    end_date: string;
  }>;
  weeklySchedule: Array<{ weekday: number; kind: string; label_key: string }>;
  sessions: Array<{
    id: string;
    scheduled_date: string;
    title_key: string;
    duration_minutes: number;
    status: string;
  }>;
  pendingProposals: Array<{
    id: string;
    triggerCode: string;
    reasonKey: string;
    explanationKey: string;
    explanationParams: Record<string, string | number>;
    changedFields: Array<{ field: string; before: unknown; after: unknown }>;
    effectiveDate: string;
  }>;
};

export function PlanPage() {
  const { t, formatDate } = useI18n();
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ackChecked, setAckChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<PlanData>('/plans/active'));
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setData(null); // no plan yet → show the generate action
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : t('error.generic'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acceptPlan() {
    if (!data || busy) return;
    setBusy(true);
    try {
      await api(`/plans/${data.plan.id}/accept`, {
        method: 'POST',
        body: { acknowledgeSafety: true },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(proposalId: string, decision: 'accepted' | 'rejected') {
    try {
      await api(`/adaptations/proposals/${proposalId}/decide`, {
        method: 'POST',
        body: { decision },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (loading) return <LoadingState />;

  async function generatePlan() {
    setBusy(true);
    try {
      await api<{ planId: string }>('/plans/generate', { method: 'POST', body: {} });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  // No plan yet (fresh onboarding) → offer generation with safety confirm.
  if (!data) {
    return (
      <div className="card" data-testid="plan-empty">
        <h1 className="text-lg font-bold text-stone-900">{t('plan.title')}</h1>
        <p className="mt-2 text-sm text-stone-600">{t('plan.accept_prompt')}</p>
        <button
          type="button"
          className="btn-primary mt-4"
          disabled={busy || !ackChecked}
          onClick={() => void generatePlan()}
          data-testid="generate-plan"
        >
          {busy ? t('state.loading') : t('action.confirm')}
        </button>
      </div>
    );
  }
  const needsAccept = data.plan.status === 'draft';

  return (
    <div className="space-y-6" data-testid="plan-page">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{t('plan.title')}</h1>
        <p className="text-sm text-stone-500">
          {t('plan.version', { version: data.plan.version })}
        </p>
      </div>

      {needsAccept && (
        <section className="card border-amber-300 bg-amber-50" aria-labelledby="accept-heading">
          <h2 id="accept-heading" className="font-semibold text-amber-950">
            {t('plan.accept_prompt')}
          </h2>
          <label className="mt-3 flex gap-3 text-sm text-amber-950">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              onChange={(e) => setAckChecked(e.target.checked)}
              data-testid="accept-safety-checkbox"
            />
            <span>
              {t('plan.accept_confirm')}
              <span className="mt-1 block text-xs text-amber-800">
                {t('onboarding.safety_ack_help')}
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={() => void acceptPlan()}
            disabled={!ackChecked || busy}
            className="btn-primary mt-4"
            data-testid="accept-plan"
          >
            {t('action.confirm')}
          </button>
        </section>
      )}

      <section className="card" aria-labelledby="phases-heading">
        <h2 id="phases-heading" className="font-semibold text-stone-900">
          {t('plan.phase')}
        </h2>
        <ol className="mt-3 space-y-3">
          {data.phases.map((phase) => (
            <li key={phase.phase_key} className="rounded-xl border border-stone-200 p-3">
              <p className="font-medium text-stone-900">
                {t(phase.title_key as Parameters<typeof t>[0])}
              </p>
              <p className="text-sm text-stone-600">
                {formatDate(phase.start_date)} – {formatDate(phase.end_date)}
              </p>
              <p className="mt-1 text-sm text-stone-500">
                {t(phase.purpose as Parameters<typeof t>[0])}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="rhythm-heading">
        <h2 id="rhythm-heading" className="font-semibold text-stone-900">
          {t('plan.weekly_rhythm')}
        </h2>
        <ul className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
          {data.weeklySchedule.map((day) => (
            <li
              key={day.weekday}
              className={`rounded-lg p-2 ${
                day.kind === 'training'
                  ? 'bg-brand-100 text-brand-900'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              <span className="block font-semibold">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][day.weekday]}
              </span>
              <span>{day.kind === 'training' ? t('plan.week.training') : t('plan.week.rest')}</span>
            </li>
          ))}
        </ul>
      </section>

      {data.pendingProposals.length > 0 && (
        <section aria-labelledby="proposals-heading">
          <h2 id="proposals-heading" className="mb-3 font-semibold text-stone-900">
            {t('today.pending_proposals', { count: data.pendingProposals.length })}
          </h2>
          <div className="space-y-3">
            {data.pendingProposals.map((p) => (
              <div key={p.id} className="card" data-testid={`proposal-${p.id}`}>
                <p className="font-medium text-stone-900">
                  {t(p.explanationKey as Parameters<typeof t>[0], p.explanationParams)}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  Effective {formatDate(p.effectiveDate)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary !min-h-9 text-sm"
                    onClick={() => void decide(p.id, 'accepted')}
                    data-testid={`accept-${p.id}`}
                  >
                    {t('action.accept')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary !min-h-9 text-sm"
                    onClick={() => void decide(p.id, 'rejected')}
                    data-testid={`reject-${p.id}`}
                  >
                    {t('action.reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.sessions.length === 0 && !needsAccept && (
        <EmptyState title={t('state.empty_title')} description={t('plan.accept_prompt')} />
      )}
    </div>
  );
}
