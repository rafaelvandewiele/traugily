import { z } from 'zod';
import { skipReasonSchema, painSeveritySchema, localeSchema } from './contracts-core';

/* ------------------------------ Plans ------------------------------ */

export const planLengthChangeSchema = z.object({
  targetWeeks: z.number().int().min(4).max(104),
});

export const acceptPlanSchema = z.object({
  acknowledgeSafety: z.boolean().refine((v) => v, 'Safety confirmation is required'),
});

/* ---------------------------- Workouts ---------------------------- */

export const setLogSchema = z.object({
  setIndex: z.number().int().min(1).max(50),
  plannedSetId: z.string().nullable().optional(),
  actualWeightKg: z.number().min(0).max(1000).nullable().optional(),
  actualReps: z.number().int().min(0).max(200).nullable().optional(),
  actualRpe: z.number().min(1).max(10).nullable().optional(),
  actualRir: z.number().int().min(0).max(20).nullable().optional(),
  status: z.enum(['completed', 'skipped', 'partial']),
  note: z.string().max(500).nullable().optional(),
  clientEventId: z.string().min(8).max(64),
  applyTo: z.enum(['this_set', 'remaining_sets', 'note_only']).default('this_set'),
});

export const skipExerciseSchema = z.object({
  exerciseId: z.string(),
  reason: skipReasonSchema,
  note: z.string().max(500).optional(),
});

export const reorderSchema = z.object({
  order: z.array(z.string()).min(1).max(30),
  clientEventId: z.string().min(8).max(64),
});

export const painReportSchema = z.object({
  severity: painSeveritySchema,
  bodyArea: z.string().max(60).default('unspecified'),
  note: z.string().max(1000).optional(),
  exerciseId: z.string().optional(),
  workoutId: z.string().optional(),
});

export const finishWorkoutSchema = z.object({
  energyRating: z.number().int().min(1).max(5).optional(),
  difficultyRating: z.number().int().min(1).max(5).optional(),
  recoveryRating: z.number().int().min(1).max(5).optional(),
  generalNote: z.string().max(1000).optional(),
  clientWorkoutId: z.string().min(8).max(64),
});

export const syncEventSchema = z.object({
  clientEventId: z.string().min(8).max(64),
  eventType: z.enum([
    'set_logged',
    'exercise_skipped',
    'exercise_reordered',
    'rest_started',
    'rest_ended',
    'workout_paused',
    'workout_resumed',
    'draft_note',
  ]),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  serverVersion: z.number().int().min(0),
});

export const syncWorkoutSchema = z.object({
  clientWorkoutId: z.string().min(8).max(64),
  baseServerVersion: z.number().int().min(0),
  events: z.array(syncEventSchema).min(1).max(200),
  draftState: z.record(z.string(), z.unknown()).optional(),
});

/* ------------------------------ Reports ------------------------------ */

export const reportRequestSchema = z
  .object({
    periodStart: z.string().length(10),
    periodEnd: z.string().length(10),
    detailLevel: z.enum(['summary', 'standard', 'detailed']).default('standard'),
    reportLocale: localeSchema.default('en'),
  })
  .refine((v) => v.periodEnd >= v.periodStart, 'End date must be on or after start date')
  .refine((v) => {
    const days = (Date.parse(v.periodEnd) - Date.parse(v.periodStart)) / 86_400_000;
    return days <= 400;
  }, 'Range must be at most 400 days');

export const moveSessionSchema = z.object({
  targetDate: z.string().length(10),
  reason: z.string().max(200).optional(),
  confirmed: z.boolean().default(false),
});
