/** Regression tests: workout elapsed-timer ms→s boundary, pause freeze, rest pause, persistence. */

import { describe, expect, it } from 'vitest';
import {
  computeElapsed,
  computeElapsedSeconds,
  pauseWorkoutState,
  resumeWorkoutState,
  shiftRestDeadline,
  type LocalWorkoutState,
} from '../../src/client/offline/db';

function baseState(): LocalWorkoutState {
  return {
    workoutId: 'w1',
    serverVersion: 1,
    startedAt: new Date('2026-10-18T10:00:00.000Z').toISOString(),
    pausedAt: null,
    pausedAccumulatedMs: 0,
    draftState: {},
    status: 'local',
    updatedAt: new Date('2026-10-18T10:00:00.000Z').toISOString(),
  };
}

describe('computeElapsed', () => {
  it('returns milliseconds while running', () => {
    const start = new Date('2026-10-18T10:00:00.000Z').toISOString();
    const now = Date.parse(start) + 90_000;
    expect(computeElapsed(start, null, 0, now)).toBe(90_000);
  });

  it('converts ms → whole seconds at the render boundary (no 548311:37)', () => {
    const start = new Date('2026-10-18T10:00:00.000Z').toISOString();
    const now = Date.parse(start) + 90_000;
    expect(computeElapsedSeconds(start, null, 0, now)).toBe(90);
    // The bug rendered raw ms as seconds: 90_000ms → 1500:00. Fixed value renders 1:30.
    const buggyMinutes = Math.floor(90_000 / 60);
    expect(buggyMinutes).toBe(1500); // documents the old symptom
    expect(Math.floor(computeElapsedSeconds(start, null, 0, now) / 60)).toBe(1);
  });

  it('freezes when pausedAt is set: later nowMs does not advance the clock', () => {
    const start = new Date('2026-10-18T10:00:00.000Z').toISOString();
    const pausedAt = new Date('2026-10-18T10:01:00.000Z').toISOString();
    const frozen = computeElapsedSeconds(start, pausedAt, 0, Date.parse(pausedAt));
    expect(frozen).toBe(60);
    // 5 minutes later with the same frozen pausedAt → still 60s (never recompute pausedAt per tick).
    expect(computeElapsedSeconds(start, pausedAt, 0, Date.parse(pausedAt) + 300_000)).toBe(60);
    expect(computeElapsedSeconds(start, pausedAt, 0, Date.parse(pausedAt) + 300_000)).toBe(frozen);
  });

  it('subtracts accumulated pause time after resume', () => {
    const start = new Date('2026-10-18T10:00:00.000Z').toISOString();
    const now = Date.parse(start) + 120_000;
    expect(computeElapsedSeconds(start, null, 30_000, now)).toBe(90);
  });

  it('clamps at zero for future starts / negative drift', () => {
    const start = new Date('2026-10-18T10:05:00.000Z').toISOString();
    const now = Date.parse('2026-10-18T10:00:00.000Z');
    expect(computeElapsed(start, null, 0, now)).toBe(0);
    expect(computeElapsedSeconds(start, null, 0, now)).toBe(0);
  });
});

describe('pause / resume state', () => {
  it('pauseWorkoutState freezes pausedAt once and persists it (idempotent)', () => {
    const s = baseState();
    const p1 = pauseWorkoutState(s, '2026-10-18T10:01:00.000Z');
    expect(p1.pausedAt).toBe('2026-10-18T10:01:00.000Z');
    // A second "pause" must NOT overwrite pausedAt with a fresh timestamp.
    const p2 = pauseWorkoutState(p1, '2026-10-18T10:05:00.000Z');
    expect(p2.pausedAt).toBe('2026-10-18T10:01:00.000Z');
  });

  it('resumeWorkoutState folds the paused span into the accumulator', () => {
    const paused = {
      ...baseState(),
      pausedAt: '2026-10-18T10:01:00.000Z',
    };
    const resumed = resumeWorkoutState(paused, '2026-10-18T10:01:30.000Z');
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pausedAccumulatedMs).toBe(30_000);
  });

  it('pause survives close: persisted pausedAt still freezes the clock on reload', () => {
    const start = baseState().startedAt;
    const persisted: LocalWorkoutState = {
      ...baseState(),
      pausedAt: '2026-10-18T10:01:00.000Z',
      pausedAccumulatedMs: 0,
    };
    // Simulate reload: tick with the persisted pausedAt long after close.
    const reloaded = computeElapsedSeconds(start, persisted.pausedAt, persisted.pausedAccumulatedMs, Date.parse('2026-10-18T10:30:00.000Z'));
    expect(reloaded).toBe(60);
  });
});

describe('rest timer pause', () => {
  it('shiftRestDeadline extends the deadline by the paused span', () => {
    const deadline = 1_000_000;
    const pausedAt = 500_000;
    const resumedAt = 560_000; // 60s frozen
    expect(shiftRestDeadline(deadline, pausedAt, resumedAt)).toBe(1_060_000);
  });

  it('never shifts backwards on clock skew', () => {
    expect(shiftRestDeadline(1_000_000, 500_000, 400_000)).toBe(1_000_000);
  });
});
