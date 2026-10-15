import { z } from 'zod';
import { localeSchema } from './contracts-core';

/* --------------------------- Nutrition/Progress --------------------------- */

export const foodLogSchema = z.object({
  loggedDate: z.string().length(10),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']),
  description: z.string().min(1).max(300),
  source: z.enum(['description', 'search', 'coarse_alternative']).default('description'),
  accuracy: z.enum(['low', 'medium', 'high']).default('low'),
  approxKcal: z.number().min(0).max(20000).nullable().optional(),
  approxProteinG: z.number().min(0).max(2000).nullable().optional(),
  approxCarbsG: z.number().min(0).max(2000).nullable().optional(),
  approxFatG: z.number().min(0).max(1000).nullable().optional(),
  suggestionId: z.string().nullable().optional(),
  note: z.string().max(300).optional(),
});

export const weighInSchema = z.object({
  entryDate: z.string().length(10),
  weightKg: z.number().min(20).max(400),
  conditions: z
    .object({
      afterToilet: z.boolean().optional(),
      beforeBreakfast: z.boolean().optional(),
      similarTime: z.boolean().optional(),
    })
    .optional(),
  skipped: z.boolean().default(false),
  skipReason: z.string().max(200).optional(),
});

export const measurementSchema = z.object({
  kind: z.enum([
    'circumference',
    'fitness_test',
    'strength_indicator',
    'energy',
    'recovery',
    'other',
  ]),
  metricKey: z.string().min(1).max(60),
  value: z.number(),
  unit: z.string().min(1).max(12),
  entryDate: z.string().length(10),
  note: z.string().max(300).optional(),
});

/* ------------------------------ Admin ------------------------------ */

export const adminExerciseSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  nameEn: z.string().min(2).max(120),
  movementPattern: z.string().min(2).max(40),
  primaryMuscles: z.array(z.string()).min(1),
  supportingMuscles: z.array(z.string()).default([]),
  equipment: z.array(z.string()).min(1),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  safetyFlags: z.array(z.string()).default([]),
  replacementGroup: z.string().nullable().optional(),
  translations: z
    .record(
      localeSchema,
      z.object({
        name: z.string().min(2).max(120),
        instructions: z.string().min(10).max(2000),
        warmupCues: z.string().max(500).default(''),
        executionSteps: z.array(z.string()).max(20).default([]),
        attentionCues: z.array(z.string()).max(20).default([]),
      }),
    )
    .optional(),
});

export const featureFlagSchema = z.object({
  enabled: z.boolean(),
  description: z.string().max(300).optional(),
});

export const supportAccessGrantSchema = z.object({
  caseId: z.string(),
  targetUserId: z.string(),
  reason: z.string().min(10).max(500),
  scope: z.array(z.string()).min(1),
  ttlHours: z.number().int().min(1).max(72).default(24),
});

export const consentSchema = z.object({
  consentKey: z.enum([
    'marketing_email',
    'push_notifications',
    'progress_photos',
    'future_integrations',
    'ai_processing',
  ]),
  granted: z.boolean(),
  version: z.string().min(1).max(20),
});
