/** Calendar: month grid of planned/completed workouts with delete-and-redo. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { ErrorState, LoadingState } from '../components/ui-states';

type MonthSession = {
  id: string;
  scheduled_date: string;
  weekday: number;
  kind: string;
  title_key: string;
  duration_minutes: number;
  status: string;
  moved_from_date: string | null;
};

type MonthData = {
  month: string;
  today: string;
  sessions: MonthSession[];
  blockedDates: Array<{ start_date: string; end_date: string; reason: string }>;
  plan: { id: string; status: string; version: number } | null;
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export function CalendarPage() {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MonthData>(`/planner/month?month=${month}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingState />;

  // Grid: Sunday-first weeks covering the full month.
  const [gy, gm] = month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(gy, gm - 1, 1)).getUTCDay();
  const totalDays = new Date(Date.UTC(gy, gm, 0)).getUTCDate();
  const days: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = 0; i < firstDow; i++) {
    const d = new Date(Date.UTC(gy, gm - 1, 1 - (firstDow - i)));
    days.push({ date: d.toISOString().slice(0, 10), inMonth: false });
  }
  for (let day = 1; day <= totalDays; day++) {
    days.push({ date: `${month}-${String(day).padStart(2, '0')}`, inMonth: true });
  }

  const sessionsByDate = new Map<string, MonthSession[]>();
  for (const s of data.sessions) {
    const arr = sessionsByDate.get(s.scheduled_date) ?? [];
    arr.push(s);
    sessionsByDate.set(s.scheduled_date, arr);
  }
  const isBlocked = (date: string) =>
    data.blockedDates.some((b) => date >= b.start_date && date <= b.end_date);

  const selSession =
    (selected ? (sessionsByDate.get(selected) ?? []) : []).find((s) => s.kind === 'workout') ?? null;

  async function deleteWorkout(sessionId: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ newStatus: string }>(`/planner/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      setNotice(res.newStatus === 'cancelled' ? t('calendar.deleted') : t('calendar.reset_for_redo'));
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function beginToday(sessionId: string) {
    setBusy(true);
    try {
      const res = await api<{ workoutId: string }>('/workouts/start', {
        method: 'POST',
        body: { sessionId },
      });
      navigate(`/workout/${res.workoutId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = (status: string) =>
    t(`calendar.status.${status}` as 'calendar.status.planned');


  return (
    <div className="space-y-6" data-testid="calendar-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-stone-900">{t('calendar.title')}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary !min-h-9 !px-3"
            aria-label={t('calendar.prev_month')}
            data-testid="calendar-prev"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className="btn-secondary !min-h-9 !px-3"
            aria-label={t('calendar.next_month')}
            data-testid="calendar-next"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          data-testid="calendar-notice"
        >
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="calendar-error">
          {error}
        </p>
      )}

      <section className="card" aria-labelledby="calendar-month-heading">
        <h2 id="calendar-month-heading" className="font-semibold text-stone-900">
          {month}
        </h2>
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAY_LABELS.map((d) => (
            <span key={d} className="py-1 font-semibold text-stone-500">
              {d}
            </span>
          ))}
          {days.map((day) => {
            const sessions = sessionsByDate.get(day.date) ?? [];
            const workout = sessions.find((s) => s.kind === 'workout');
            const blocked = isBlocked(day.date);
            const isSelected = selected === day.date;
            const isToday = day.date === data.today;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelected(day.date)}
                data-testid={`calendar-day-${day.date}`}
                className={`relative min-h-11 rounded-lg border p-2 text-left ${
                  isSelected
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-stone-200 bg-white hover:bg-stone-50'
                } ${!day.inMonth ? 'opacity-40' : ''} ${isToday ? 'ring-2 ring-brand-500' : ''}`}
              >
                <span className="block font-medium text-stone-800">{Number(day.date.slice(8))}</span>
                {workout && (
                  <span
                    className={`mt-1 inline-block h-2 w-2 rounded-full ${
                      workout.status === 'completed'
                        ? 'bg-emerald-500'
                        : workout.status === 'cancelled'
                          ? 'bg-stone-300'
                          : 'bg-brand-500'
                    }`}
                    aria-hidden
                  />
                )}
                {blocked && (
                  <span className="mt-1 ml-1 inline-block h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-500">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-500 align-middle" />
            {t('calendar.status.planned')}
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
            {t('calendar.status.completed')}
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-stone-300 align-middle" />
            {t('calendar.status.cancelled')}
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" />
            {t('calendar.blocked')}
          </span>
        </div>
      </section>

      {selected && (
        <section
          className="card"
          aria-labelledby="calendar-day-heading"
          data-testid="calendar-day-panel"
        >
          <h2 id="calendar-day-heading" className="font-semibold text-stone-900">
            {formatDate(selected)}
          </h2>
          {!selSession ? (
            <p className="mt-2 text-sm text-stone-500">{t('calendar.no_workout')}</p>
          ) : (
            <div className="mt-2 space-y-2 text-sm">
              <p className="font-medium text-stone-800">
                {t(selSession.title_key as Parameters<typeof t>[0])} · {selSession.duration_minutes} min
              </p>
              <p className="text-stone-500" data-testid="calendar-session-status">
                {statusLabel(selSession.status)}
              </p>
              {selSession.status === 'planned' && selected === data.today && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  data-testid="calendar-begin"
                  onClick={() => void beginToday(selSession.id)}
                >
                  {t('calendar.begin_workout')}
                </button>
              )}
              {(selSession.status === 'planned' || selSession.status === 'completed') && (
                <div>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy}
                    data-testid="calendar-delete"
                    onClick={() => void deleteWorkout(selSession.id)}
                  >
                    {selSession.status === 'completed'
                      ? t('calendar.redo_workout')
                      : t('calendar.delete_workout')}
                  </button>
                  <p className="mt-1 text-xs text-stone-400">{t('calendar.delete_hint')}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
