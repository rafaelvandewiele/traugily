/** Workout player: set logging (planned vs actual), rest timer, reorder, skip, pain report, finish. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Flag,
  Pause,
  Play,
  SkipForward,
  Timer,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { useOnline } from '../hooks/useOnline';
import { ErrorState, LoadingState, OfflineBadge } from '../components/ui-states';
import {
  computeElapsedSeconds,
  enqueueEvent,
  listQueuedEvents,
  loadLocalWorkout,
  pauseWorkoutState,
  removeLocalWorkout,
  removeQueuedEvent,
  resumeWorkoutState,
  saveLocalWorkout,
  shiftRestDeadline,
  type LocalWorkoutState,
} from '../offline/db';

type ExerciseData = {
  id: string;
  exercise_id: string;
  name_en: string;
  actual_position: number;
  status: string;
  skip_reason: string | null;
  sets: Array<{
    set_index: number;
    planned_reps: number | null;
    planned_weight_kg: number | null;
    planned_rir: number | null;
    rest_seconds: number | null;
    actual_reps: number | null;
    actual_weight_kg: number | null;
    actual_rpe: number | null;
    status: string;
  }>;
};

type WorkoutDetail = {
  workoutId: string;
  serverVersion: number;
  startedAt: string;
  state: string;
  exercises: ExerciseData[];
};

type SafetyEvaluation = {
  severity: string;
  guidanceKey: string | null;
  stopTraining: boolean;
  requiresFollowUp: boolean;
  blockedRuleId: string | null;
};

function uuid(): string {
  return crypto.randomUUID();
}

export function WorkoutPlayerPage() {
  const { workoutId = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();

  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalWorkoutState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const [restPaused, setRestPaused] = useState(false);
  const restDeadline = useRef<number | null>(null);
  const restPausedAt = useRef<number | null>(null);
  // `paused` is derived from persisted `local.pausedAt` so a reload/close keeps the frozen clock.
  const [elapsed, setElapsed] = useState(0);
  const paused = local?.pausedAt != null;
  const [setValues, setSetValues] = useState<
    Record<string, { reps: string; weight: string; rpe: string }>
  >({});
  const [applyTo, setApplyTo] = useState<'this_set' | 'remaining_sets' | 'note_only'>('this_set');
  const [showSkip, setShowSkip] = useState(false);
  const [skipReason, setSkipReason] = useState('time');
  const [showPain, setShowPain] = useState(false);
  const [painSeverity, setPainSeverity] = useState<'discomfort' | 'pain' | 'urgent'>('discomfort');
  const [painNote, setPainNote] = useState('');
  const [safety, setSafety] = useState<SafetyEvaluation | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [syncStatus, setSyncStatus] = useState<LocalWorkoutState['status']>('synced');
  const [conflict, setConflict] = useState<{
    clientBaseVersion: number;
    serverVersion: number;
  } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setErrors, setSetErrors] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<WorkoutDetail>(`/workouts/${workoutId}/state`);
      setDetail(res);
      const localState = await loadLocalWorkout(workoutId);
      setLocal(localState ?? null);
      setSyncStatus(localState?.status ?? 'synced');
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'network_error') {
        const localState = await loadLocalWorkout(workoutId);
        if (localState) {
          setLocal(localState);
          setSyncStatus('local');
          return;
        }
      }
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }, [workoutId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Session timer — timestamp based so it stays correct after backgrounding.
  // computeElapsedSeconds converts the ms boundary to whole seconds for mm:ss rendering.
  const workoutStartedAt = detail ? (local?.startedAt ?? detail.startedAt) : null;
  const pausedAtPersisted = local?.pausedAt ?? null;
  const pausedAccum = local?.pausedAccumulatedMs ?? 0;
  useEffect(() => {
    if (!workoutStartedAt) return;
    const tick = () => {
      setElapsed(computeElapsedSeconds(workoutStartedAt, pausedAtPersisted, pausedAccum));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [workoutStartedAt, pausedAtPersisted, pausedAccum]);

  // Rest timer — deadline based (timestamp), robust to backgrounding.
  // Honors restPaused: while paused the interval skips the countdown so the clock freezes.
  const [restEpoch, setRestEpoch] = useState(0);
  useEffect(() => {
    if (restDeadline.current == null) return;
    if (restPaused) return;
    const interval = window.setInterval(() => {
      if (restDeadline.current == null) return;
      const remaining = Math.max(0, Math.round((restDeadline.current - Date.now()) / 1000));
      setRestRemaining(remaining);
      if (remaining === 0) {
        restDeadline.current = null;
        restPausedAt.current = null;
        window.clearInterval(interval);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [restEpoch, restPaused]);

  /** Toggle the session pause. Freezes `pausedAt` once, persists it so close/unmount keeps it. */
  async function togglePause() {
    const nowIso = new Date().toISOString();
    const base: LocalWorkoutState | null =
      local ??
      (detail
        ? {
            workoutId,
            serverVersion: detail.serverVersion,
            startedAt: detail.startedAt,
            pausedAt: null,
            pausedAccumulatedMs: 0,
            draftState: {},
            status: 'local' as const,
            updatedAt: nowIso,
          }
        : null);
    if (!base) return;
    const next = base.pausedAt ? resumeWorkoutState(base, nowIso) : pauseWorkoutState(base, nowIso);
    await saveLocalWorkout(next);
    setLocal(next);
  }

  /** Toggle the rest-timer pause. Shifts the deadline on resume so no time leaks while frozen. */
  function toggleRestPause() {
    if (restDeadline.current == null) return;
    if (!restPaused) {
      restPausedAt.current = Date.now();
      setRestPaused(true);
    } else {
      if (restPausedAt.current != null) {
        restDeadline.current = shiftRestDeadline(restDeadline.current, restPausedAt.current, Date.now());
        restPausedAt.current = null;
      }
      setRestPaused(false);
    }
  }

  // Persist pause on unmount/close: if the clock is frozen, the paused state is already
  // saved via togglePause, but re-save on cleanup guards against a close mid-tick.
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => {
    return () => {
      const cur = localRef.current;
      if (cur?.pausedAt) void saveLocalWorkout(cur).catch(() => {});
    };
  }, []);

  /** Push queued events; on conflict (409) surface resolution instead of overwriting. */
  const syncEvents = useCallback(async () => {
    if (!detail) return;
    const queued = await listQueuedEvents(workoutId);
    if (queued.length === 0) {
      setSyncStatus('synced');
      return;
    }
    try {
      const res = await api<{ serverVersion: number }>(`/workouts/${workoutId}/sync`, {
        method: 'POST',
        body: {
          clientWorkoutId: workoutId,
          baseServerVersion: local?.serverVersion ?? detail.serverVersion,
          events: queued,
        },
      });
      for (const ev of queued) await removeQueuedEvent(ev.clientEventId);
      const next: LocalWorkoutState = {
        workoutId,
        serverVersion: res.serverVersion,
        startedAt: local?.startedAt ?? detail.startedAt,
        pausedAt: null,
        pausedAccumulatedMs: local?.pausedAccumulatedMs ?? 0,
        draftState: {},
        status: 'synced',
        updatedAt: new Date().toISOString(),
      };
      await saveLocalWorkout(next);
      setLocal(next);
      setSyncStatus('synced');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'version_conflict') {
        // Surface the conflict for an explicit choice — never overwrite silently.
        const raw = (err.payload?.conflict ?? null) as {
          clientBaseVersion?: number;
          serverVersion?: number;
        } | null;
        setConflict({
          clientBaseVersion: raw?.clientBaseVersion ?? local?.serverVersion ?? 0,
          serverVersion: raw?.serverVersion ?? 0,
        });
        setConfirmDiscard(false);
        setSyncStatus('attention');
        return;
      }
      setSyncStatus(online ? 'pending' : 'local');
    }
  }, [detail, workoutId, local, online, load]);

  useEffect(() => {
    if (online) void syncEvents();
  }, [online, syncEvents]);

  async function queueAndSync(eventType: string, payload: Record<string, unknown>) {
    const event = {
      clientEventId: uuid(),
      eventType,
      payload: { ...payload, workoutId },
      occurredAt: new Date().toISOString(),
      serverVersion: local?.serverVersion ?? detail?.serverVersion ?? 0,
    };
    await enqueueEvent(event);
    const next: LocalWorkoutState = {
      workoutId,
      serverVersion: local?.serverVersion ?? detail?.serverVersion ?? 1,
      startedAt: local?.startedAt ?? detail?.startedAt ?? new Date().toISOString(),
      pausedAt: local?.pausedAt ?? null,
      pausedAccumulatedMs: local?.pausedAccumulatedMs ?? 0,
      draftState: {},
      status: online ? 'pending' : 'local',
      updatedAt: new Date().toISOString(),
    };
    await saveLocalWorkout(next);
    setLocal(next);
    setSyncStatus(next.status);
    if (online) await syncEvents();
  }

  /** Conflict choice A: keep this device's entries (explicit rebase, audited). */
  async function resolveKeepLocal() {
    if (!conflict) return;
    const queued = await listQueuedEvents(workoutId);
    try {
      const res = await api<{ serverVersion: number }>(`/workouts/${workoutId}/sync`, {
        method: 'POST',
        body: {
          clientWorkoutId: workoutId,
          baseServerVersion: conflict.serverVersion,
          events: queued,
          rebase: true,
        },
      });
      for (const ev of queued) await removeQueuedEvent(ev.clientEventId);
      const next: LocalWorkoutState = {
        workoutId,
        serverVersion: res.serverVersion,
        startedAt: local?.startedAt ?? detail?.startedAt ?? new Date().toISOString(),
        pausedAt: null,
        pausedAccumulatedMs: local?.pausedAccumulatedMs ?? 0,
        draftState: {},
        status: 'synced',
        updatedAt: new Date().toISOString(),
      };
      await saveLocalWorkout(next);
      setLocal(next);
      setConflict(null);
      setConfirmDiscard(false);
      setSyncStatus('synced');
      await load();
    } catch {
      setSyncStatus('attention'); // still conflicted; the panel stays visible
    }
  }

  /** Conflict choice B: keep the other device's version (explicit, two-step). */
  async function resolveKeepRemote() {
    if (!conflict) return;
    const queued = await listQueuedEvents(workoutId);
    for (const ev of queued) await removeQueuedEvent(ev.clientEventId);
    try {
      const res = await api<{ serverVersion: number }>(`/workouts/${workoutId}/state`);
      const next: LocalWorkoutState = {
        workoutId,
        serverVersion: res.serverVersion,
        startedAt: local?.startedAt ?? detail?.startedAt ?? new Date().toISOString(),
        pausedAt: null,
        pausedAccumulatedMs: local?.pausedAccumulatedMs ?? 0,
        draftState: {},
        status: 'synced',
        updatedAt: new Date().toISOString(),
      };
      await saveLocalWorkout(next);
      setLocal(next);
      setConflict(null);
      setConfirmDiscard(false);
      setSyncStatus('synced');
      await load();
    } catch {
      setSyncStatus('attention');
    }
  }

  function startRest(seconds: number | null) {
    if (!seconds) return;
    restDeadline.current = Date.now() + seconds * 1000;
    setRestRemaining(seconds);
    setRestPaused(false);
    setRestEpoch((n) => n + 1);
  }

  async function saveSet(ex: ExerciseData, setIdx: number) {
    if (busy) return;
    setBusy(true);
    const key = `${ex.id}-${setIdx}`;
    const values = setValues[key] ?? { reps: '', weight: '', rpe: '' };
    const reps = values.reps ? Number(values.reps) : null;
    const weight = values.weight ? Number(values.weight) : null;
    const rpe = values.rpe ? Number(values.rpe) : null;
    // Client guard (task_0002): never send status:'partial' with all-null
    // actuals — the finish gate needs >=1 completed set with actual > 0, and
    // an empty row stored as 'partial' poisons it silently.
    const hasActual = reps != null || weight != null || rpe != null;
    if (!hasActual) {
      setSetErrors((prev) => ({ ...prev, [key]: t('log.set_empty') }));
      setBusy(false);
      return;
    }
    setSetErrors((prev) => ({ ...prev, [key]: null }));
    try {
      await api(`/workouts/${workoutId}/sets`, {
        method: 'POST',
        body: {
          exerciseId: ex.exercise_id,
          setIndex: setIdx,
          actualReps: reps,
          actualWeightKg: weight,
          actualRpe: rpe,
          status: (reps ?? 0) > 0 || (weight ?? 0) > 0 ? 'completed' : 'partial',
          clientEventId: uuid(),
          applyTo,
        },
      });
      setNotice(t('log.set_saved'));
      setSetValues((prev) => ({ ...prev, [key]: { reps: '', weight: values.weight, rpe: '' } }));
      const nextSet = ex.sets.find((s) => s.set_index === setIdx + 1);
      if (nextSet) startRest(nextSet.rest_seconds);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'network_error') {
        // Genuinely offline: keep it queued locally — nothing is lost.
        await queueAndSync('set_logged', {
          performedExerciseId: ex.id,
          exerciseId: ex.exercise_id,
          setIndex: setIdx,
          reps,
          weightKg: weight,
          rpe,
          status: (reps ?? 0) > 0 || (weight ?? 0) > 0 ? 'completed' : 'partial',
        });
        setNotice(t('log.set_queued_offline'));
        return;
      }
      // Real server errors (validation, auth, finished workout…) must be
      // visible — never swallowed into the offline queue.
      if (err instanceof ApiClientError && err.field === 'set_empty') {
        setSetErrors((prev) => ({ ...prev, [key]: t('log.set_empty') }));
      } else {
        setError(err instanceof Error ? err.message : t('error.generic'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function skipExercise(ex: ExerciseData) {
    try {
      // Direct API call when online — the queue is only for real offline.
      await api(`/workouts/${workoutId}/skip`, {
        method: 'POST',
        body: { exerciseId: ex.exercise_id, reason: skipReason },
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'network_error') {
        await queueAndSync('exercise_skipped', { exerciseId: ex.exercise_id, reason: skipReason });
      } else {
        setError(err instanceof Error ? err.message : t('error.generic'));
        return; // keep the dialog open so the member can retry or cancel
      }
    }
    setShowSkip(false);
    await load();
    setActiveIdx(Math.min(activeIdx + 1, Math.max(0, (detail?.exercises.length ?? 1) - 1)));
  }

  async function moveExercise(idx: number, direction: -1 | 1) {
    if (!detail) return;
    const order = [...detail.exercises];
    const target = idx + direction;
    if (target < 0 || target >= order.length) return;
    const tmp = order[idx];
    order[idx] = order[target];
    order[target] = tmp;
    setDetail({ ...detail, exercises: order });
    const ids = order.map((e) => e.exercise_id);
    try {
      await api(`/workouts/${workoutId}/reorder`, {
        method: 'POST',
        body: { order: ids, clientEventId: uuid() },
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'network_error') {
        await queueAndSync('exercise_reordered', { order: ids });
      } else {
        setError(err instanceof Error ? err.message : t('error.generic'));
        await load(); // restore server truth after a failed optimistic move
      }
    }
  }

  async function reportPain() {
    try {
      const res = await api<{ evaluation: SafetyEvaluation }>('/safety/report', {
        method: 'POST',
        body: {
          severity: painSeverity,
          bodyArea: 'unspecified',
          note: painNote || undefined,
          workoutId,
        },
      });
      setSafety(res.evaluation);
      setShowPain(false);
      await queueAndSync('draft_note', { painReported: true, severity: painSeverity });
    } catch {
      setError(t('error.network'));
    }
  }

  /** Flush offline-queued events before finishing so skips/sets land in the summary. */
  async function flushQueuedEvents(): Promise<void> {
    const queued = await listQueuedEvents(workoutId);
    if (queued.length === 0) return;
    const fresh = await api<WorkoutDetail>(`/workouts/${workoutId}/state`);
    const freshLocal = await loadLocalWorkout(workoutId);
    const body = {
      clientWorkoutId: workoutId,
      baseServerVersion: freshLocal?.serverVersion ?? fresh.serverVersion,
      events: queued,
    };
    try {
      await api(`/workouts/${workoutId}/sync`, { method: 'POST', body });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'version_conflict') {
        // Drift came from this device's own direct saves — audited rebase applies
        // the member's queued events instead of losing them.
        await api(`/workouts/${workoutId}/sync`, {
          method: 'POST',
          body: { ...body, rebase: true },
        });
      } else {
        throw err;
      }
    }
    for (const ev of queued) await removeQueuedEvent(ev.clientEventId);
  }

  async function finishWorkout() {
    if (busy) return;
    setBusy(true);
    try {
      await flushQueuedEvents();
      const res = await api<{ summary: Record<string, number | string> }>(
        `/workouts/${workoutId}/finish`,
        { method: 'POST', body: { clientWorkoutId: workoutId } },
      );
      await removeLocalWorkout(workoutId);
      setSyncStatus('synced');
      sessionStorage.setItem('tg_last_summary', JSON.stringify(res.summary));
      navigate('/log?finished=1');
    } catch (err) {
      // Surface the real reason inline (incl. the no_executed_sets gate) and
      // keep the review dialog open so the member can log a set first.
      const message =
        err instanceof ApiClientError && err.field === 'no_executed_sets'
          ? t('log.no_executed_sets')
          : err instanceof Error
            ? err.message
            : t('error.generic');
      setError(message);
      setNotice(message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return <LoadingState />;

  const ex = detail.exercises[activeIdx];
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="workout-player">
      {/* Header: timer, sync status, safety action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !min-h-9 !px-3"
            onClick={() => void togglePause()}
            aria-pressed={paused}
            data-testid="session-pause-toggle"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {minutes}:{String(seconds).padStart(2, '0')}
          </button>
          <OfflineBadge status={syncStatus} />
        </div>
        <button
          type="button"
          onClick={() => setShowPain(true)}
          className="btn-danger !min-h-9 !px-3 text-sm"
          data-testid="report-pain"
        >
          <Flag className="h-4 w-4" aria-hidden />
          {t('log.report_pain')}
        </button>
      </div>

      {/* Sync conflict — member resolves explicitly; nothing is overwritten silently. */}
      {conflict && (
        <div
          role="alert"
          data-testid="sync-conflict"
          className="card space-y-3 border-amber-300 bg-amber-50"
        >
          <p className="font-semibold text-stone-900">{t('state.conflict_title')}</p>
          <p className="text-sm text-stone-700">{t('state.conflict_body')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="conflict-keep-local"
              onClick={() => void resolveKeepLocal()}
              className="btn-primary"
            >
              {t('state.conflict_keep_local')}
            </button>
            {!confirmDiscard ? (
              <button
                type="button"
                data-testid="conflict-keep-remote"
                onClick={() => setConfirmDiscard(true)}
                className="btn-secondary"
              >
                {t('state.conflict_keep_remote')}
              </button>
            ) : (
              <button
                type="button"
                data-testid="conflict-confirm-remote"
                onClick={() => void resolveKeepRemote()}
                className="btn-danger"
              >
                {t('state.conflict_discard_confirm')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Safety guidance banner — takes priority over everything else. */}
      {safety && safety.guidanceKey && (
        <div
          role="alert"
          data-testid="safety-guidance"
          className={`rounded-2xl border p-4 ${
            safety.severity === 'urgent'
              ? 'border-red-300 bg-red-50'
              : safety.severity === 'block'
                ? 'border-amber-300 bg-amber-50'
                : 'border-brand-200 bg-brand-50'
          }`}
        >
          <p
            className={`text-sm font-semibold ${
              safety.severity === 'urgent' ? 'text-red-900' : 'text-stone-900'
            }`}
          >
            <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />
            {t(safety.guidanceKey as Parameters<typeof t>[0])}
          </p>
        </div>
      )}

      {/* Rest timer */}
      {restRemaining !== null && restRemaining > 0 && (
        <div className="card flex items-center justify-between border-brand-200 bg-brand-50">
          <p
            className="flex items-center gap-2 font-semibold text-brand-900"
            data-testid="rest-timer"
          >
            <Timer className="h-5 w-5" aria-hidden />
            {t('log.rest_timer')}: {Math.floor(restRemaining / 60)}:
            {String(restRemaining % 60).padStart(2, '0')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary !min-h-9 text-sm"
              onClick={toggleRestPause}
              data-testid="rest-pause-toggle"
              aria-pressed={restPaused}
            >
              {restPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="btn-secondary !min-h-9 text-sm"
              onClick={() => {
                restDeadline.current = null;
                setRestRemaining(null);
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Exercise navigation + reorder controls */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-stone-600">
          {activeIdx + 1} / {detail.exercises.length}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="btn-secondary !min-h-9 !px-2"
            aria-label="Move exercise up"
            onClick={() => void moveExercise(activeIdx, -1)}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className="btn-secondary !min-h-9 !px-2"
            aria-label="Move exercise down"
            onClick={() => void moveExercise(activeIdx, 1)}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {detail.exercises.map((e, idx) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => setActiveIdx(idx)}
              aria-current={idx === activeIdx}
              className={
                idx === activeIdx
                  ? 'btn-primary !min-h-9 !px-3 text-sm'
                  : 'btn-secondary !min-h-9 !px-3 text-sm'
              }
            >
              {idx + 1}. {e.name_en}
            </button>
          </li>
        ))}
      </ul>

      {notice && (
        <p role="status" className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
          {notice}
        </p>
      )}

      {ex && (
        <section className="card" aria-labelledby="current-exercise">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="current-exercise" className="text-lg font-bold text-stone-900">
                {ex.name_en}
              </h2>
              <p className="text-xs text-stone-500">
                {t('log.planned')} → {t('log.actual')}
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary !min-h-9 text-sm"
              onClick={() => setShowSkip(true)}
              data-testid="skip-exercise"
            >
              <SkipForward className="h-4 w-4" aria-hidden />
              Skip
            </button>
          </div>

          {/* Planned vs actual side by side */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm" data-testid="sets-table">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th scope="col" className="py-2 pr-2">
                    #
                  </th>
                  <th scope="col" className="py-2 pr-2">
                    {t('log.planned')}
                  </th>
                  <th scope="col" className="py-2 pr-2">
                    {t('log.actual')}
                  </th>
                  <th scope="col" className="py-2 pr-2">
                    RPE
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Save</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((s) => {
                  const key = `${ex.id}-${s.set_index}`;
                  const v = setValues[key] ?? { reps: '', weight: '', rpe: '' };
                  const planned =
                    `${s.planned_reps ?? '—'} reps` +
                    (s.planned_weight_kg != null ? ` × ${s.planned_weight_kg} kg` : '');
                  const actualDone =
                    s.actual_reps != null || s.actual_weight_kg != null
                      ? `${s.actual_reps ?? '—'} reps` +
                        (s.actual_weight_kg != null ? ` × ${s.actual_weight_kg} kg` : '')
                      : null;
                  return (
                    <tr
                      key={s.set_index}
                      className="border-b border-stone-100"
                      data-testid={`set-row-${s.set_index}`}
                    >
                      <td className="py-2 pr-2 font-medium">{s.set_index}</td>
                      <td className="py-2 pr-2 text-stone-600">{planned}</td>
                      <td className="py-2 pr-2">
                        <div className="flex gap-1">
                          <input
                            aria-label={`Set ${s.set_index} weight kg`}
                            type="number"
                            step="0.5"
                            className="input !min-h-9 !w-20 !px-2 text-sm"
                            placeholder="kg"
                            value={v.weight}
                            onChange={(e) =>
                              setSetValues((p) => ({
                                ...p,
                                [key]: { ...v, weight: e.target.value },
                              }))
                            }
                          />
                          <input
                            aria-label={`Set ${s.set_index} reps`}
                            type="number"
                            className="input !min-h-9 !w-16 !px-2 text-sm"
                            placeholder="reps"
                            value={v.reps}
                            onChange={(e) =>
                              setSetValues((p) => ({ ...p, [key]: { ...v, reps: e.target.value } }))
                            }
                          />
                        </div>
                        {actualDone && (
                          <span
                            className="mt-1 block text-xs text-brand-700"
                            data-testid={`actual-${s.set_index}`}
                          >
                            ✓ {actualDone}
                          </span>
                        )}
                        {setErrors[key] && (
                          <span
                            className="mt-1 block text-xs text-red-700"
                            role="alert"
                            data-testid={`set-error-${s.set_index}`}
                          >
                            {setErrors[key]}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <input
                          aria-label={`Set ${s.set_index} RPE`}
                          type="number"
                          min={1}
                          max={10}
                          className="input !min-h-9 !w-14 !px-2 text-sm"
                          placeholder="1–10"
                          value={v.rpe}
                          onChange={(e) =>
                            setSetValues((p) => ({ ...p, [key]: { ...v, rpe: e.target.value } }))
                          }
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="btn-primary !min-h-9 !px-3 text-sm"
                          onClick={() => void saveSet(ex, s.set_index)}
                          data-testid={`save-set-${s.set_index}`}
                        >
                          Log
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span>{t('log.apply_change')}</span>
            {(['this_set', 'remaining_sets', 'note_only'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={applyTo === opt}
                onClick={() => setApplyTo(opt)}
                className={
                  applyTo === opt
                    ? 'btn-primary !min-h-8 !px-2 !text-xs'
                    : 'btn-secondary !min-h-8 !px-2 !text-xs'
                }
              >
                {t(`log.apply.${opt}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Finish action — available at any time */}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowFinish(true)}
          data-testid="finish-workout"
        >
          {t('action.finish_workout')}
        </button>
      </div>

      {/* Skip dialog */}
      {showSkip && ex && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('log.skip_reason')}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <h2 className="font-semibold text-stone-900">{t('log.skip_reason')}</h2>
            <div className="mt-3 space-y-2">
              {(
                [
                  'time',
                  'equipment_unavailable',
                  'discomfort',
                  'too_difficult',
                  'preference',
                  'other',
                  'no_reason',
                ] as const
              ).map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="skip-reason"
                    checked={skipReason === reason}
                    onChange={() => setSkipReason(reason)}
                  />
                  {t(`log.skip.${reason}` as Parameters<typeof t>[0])}
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() => void skipExercise(ex)}
                data-testid="confirm-skip"
              >
                {t('action.confirm')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowSkip(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pain/discomfort report dialog */}
      {showPain && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('log.report_pain')}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <h2 className="font-semibold text-stone-900">{t('log.report_pain')}</h2>
            <div className="mt-3 space-y-2">
              {(['discomfort', 'pain', 'urgent'] as const).map((severity) => (
                <label
                  key={severity}
                  className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="pain-severity"
                    checked={painSeverity === severity}
                    onChange={() => setPainSeverity(severity)}
                    data-testid={`pain-${severity}`}
                  />
                  {t(`log.pain.${severity}` as Parameters<typeof t>[0])}
                </label>
              ))}
            </div>
            <label className="label mt-3" htmlFor="pain-note">
              {t('log.pain_note')}
            </label>
            <textarea
              id="pain-note"
              className="input min-h-20"
              value={painNote}
              onChange={(e) => setPainNote(e.target.value)}
              maxLength={1000}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() => void reportPain()}
                data-testid="submit-pain"
              >
                {t('action.confirm')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowPain(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish confirmation */}
      {showFinish && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('log.review_before_save')}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <h2 className="font-semibold text-stone-900">{t('log.review_before_save')}</h2>
            <p className="mt-2 text-sm text-stone-600">
              {t('log.duration')}: {minutes}m {seconds}s
            </p>
            <p className="text-sm text-stone-500">{t('log.calories_note')}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={busy}
                onClick={() => void finishWorkout()}
                data-testid="confirm-finish"
              >
                {t('action.finish_workout')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowFinish(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
