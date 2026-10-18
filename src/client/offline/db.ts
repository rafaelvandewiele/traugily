/** IndexedDB store for offline workout drafts + event queue. */

export type QueuedEvent = {
  clientEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  serverVersion: number;
};

export type LocalWorkoutState = {
  workoutId: string;
  serverVersion: number;
  startedAt: string;
  pausedAt: string | null;
  pausedAccumulatedMs: number;
  draftState: Record<string, unknown>;
  status: 'local' | 'pending' | 'synced' | 'attention';
  updatedAt: string;
};

const DB_NAME = 'traugily';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('workouts'))
        db.createObjectStore('workouts', { keyPath: 'workoutId' });
      if (!db.objectStoreNames.contains('events'))
        db.createObjectStore('events', { keyPath: 'clientEventId' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveLocalWorkout(state: LocalWorkoutState): Promise<void> {
  await tx('workouts', 'readwrite', (s) =>
    s.put({ ...state, updatedAt: new Date().toISOString() }),
  );
}

export async function loadLocalWorkout(workoutId: string): Promise<LocalWorkoutState | undefined> {
  return tx<LocalWorkoutState | undefined>('workouts', 'readonly', (s) => s.get(workoutId));
}

export async function listLocalWorkouts(): Promise<LocalWorkoutState[]> {
  return tx<LocalWorkoutState[]>('workouts', 'readonly', (s) => s.getAll());
}

export async function removeLocalWorkout(workoutId: string): Promise<void> {
  await tx('workouts', 'readwrite', (s) => s.delete(workoutId));
}

export async function enqueueEvent(event: QueuedEvent): Promise<void> {
  await tx('events', 'readwrite', (s) => s.put(event));
  await setMeta('lastQueuedAt', event.occurredAt);
}

export async function listQueuedEvents(workoutId: string): Promise<QueuedEvent[]> {
  const all = await tx<QueuedEvent[]>('events', 'readonly', (s) => s.getAll());
  return all
    .filter((e) => (e.payload?.workoutId as string | undefined) === workoutId)
    .slice(0, 200);
}

export async function removeQueuedEvent(clientEventId: string): Promise<void> {
  await tx('events', 'readwrite', (s) => s.delete(clientEventId));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx('meta', 'readwrite', (s) => s.put({ key, value }));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await tx<{ key: string; value: T } | undefined>('meta', 'readonly', (s) =>
    s.get(key),
  );
  return row?.value;
}

/** Timestamp-based elapsed time: correct after backgrounding on iOS/Android.
 * Returns **milliseconds** (use `computeElapsedSeconds` at render boundaries). */
export function computeElapsed(
  startedAtIso: string,
  pausedAtIso: string | null,
  pausedAccumulatedMs: number,
  nowMs = Date.now(),
): number {
  const started = Date.parse(startedAtIso);
  const base = nowMs - started - pausedAccumulatedMs;
  if (pausedAtIso) {
    return Math.max(0, Date.parse(pausedAtIso) - started - pausedAccumulatedMs);
  }
  return Math.max(0, base);
}

/** Elapsed whole seconds for rendering (mm:ss). Converts the ms boundary. */
export function computeElapsedSeconds(
  startedAtIso: string,
  pausedAtIso: string | null,
  pausedAccumulatedMs: number,
  nowMs = Date.now(),
): number {
  return Math.floor(computeElapsed(startedAtIso, pausedAtIso, pausedAccumulatedMs, nowMs) / 1000);
}

/** Freeze the clock: record when the pause started (idempotent). */
export function pauseWorkoutState(
  state: LocalWorkoutState,
  nowIso: string = new Date().toISOString(),
): LocalWorkoutState {
  if (state.pausedAt) return state;
  return { ...state, pausedAt: nowIso, updatedAt: nowIso };
}

/** Resume the clock: fold the paused span into the accumulator. */
export function resumeWorkoutState(
  state: LocalWorkoutState,
  nowIso: string = new Date().toISOString(),
): LocalWorkoutState {
  if (!state.pausedAt) return state;
  const pausedMs = Math.max(0, Date.parse(nowIso) - Date.parse(state.pausedAt));
  return {
    ...state,
    pausedAt: null,
    pausedAccumulatedMs: state.pausedAccumulatedMs + pausedMs,
    updatedAt: nowIso,
  };
}

/** Shift a rest deadline forward by the paused span so resume continues where it left off. */
export function shiftRestDeadline(
  deadlineMs: number,
  pausedAtMs: number,
  resumedAtMs: number,
): number {
  return deadlineMs + Math.max(0, resumedAtMs - pausedAtMs);
}
