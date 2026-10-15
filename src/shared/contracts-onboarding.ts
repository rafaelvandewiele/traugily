import { z } from 'zod';
import { goalTypeSchema } from './contracts-core';

/* ---------------------------- Onboarding ---------------------------- */

export const onboardingBasicsSchema = z.object({
  birthYear: z.number().int().min(1900).max(2015).nullable().optional(),
  ageBand: z.enum(['18-24', '25-34', '35-44', '45-54', '55-64', '65+']).optional(),
  sex: z.enum(['female', 'male', 'intersex', 'prefer_not_to_say']).optional(),
  heightCm: z.number().positive().max(250).nullable().optional(),
  weightKg: z.number().positive().max(400).nullable().optional(),
  country: z.string().max(2).optional(),
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

export const onboardingGoalsSchema = z.object({
  goals: z
    .array(z.object({ goalType: goalTypeSchema, priority: z.number().int().min(1).max(9) }))
    .min(1)
    .max(6)
    .refine(
      (goals) => new Set(goals.map((g) => g.goalType)).size === goals.length,
      'Choose each goal only once',
    ),
  targetWeeks: z.number().int().min(4).max(104),
  acknowledgedRange: z
    .boolean()
    .refine((v) => v, 'Please confirm you understand the realistic range'),
});

export const onboardingTrainingSchema = z.object({
  experienceLevel: z.enum(['new', 'returning', 'experienced']),
  priorTraining: z.string().max(1000).optional(),
  knownLifts: z.string().max(1000).optional(),
  preferredWeekdays: z.array(z.number().int().min(0).max(6)).min(2).max(7),
  minutesPerSession: z.number().int().min(15).max(180),
  sessionsPerWeek: z.number().int().min(2).max(7),
  locations: z.array(z.enum(['home', 'gym', 'outdoors'])).min(1),
  equipment: z
    .array(
      z.object({
        category: z.enum([
          'free_weights',
          'barbells',
          'cables',
          'machines',
          'cardio',
          'bodyweight',
          'home_equipment',
        ]),
        status: z.enum(['available', 'not_available', 'unknown']),
        muscleGroup: z.string().max(40).optional(),
      }),
    )
    .min(1),
  exclusions: z
    .array(
      z.object({
        exerciseId: z.string().optional(),
        replacementGroup: z.string().optional(),
        reasonCode: z.enum(['equipment', 'preference', 'skill', 'discomfort', 'other']),
        reasonNote: z.string().max(300).optional(),
      }),
    )
    .max(20),
  blockedDates: z
    .array(z.object({ startDate: z.string().length(10), endDate: z.string().length(10) }))
    .max(10),
});

export const onboardingLifestyleSchema = z.object({
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'high', 'very_high']),
  workPattern: z.enum(['desk', 'mixed', 'physical', 'irregular']),
  sleepIndicator: z.enum(['poor', 'fair', 'good', 'very_good']),
  stressIndicator: z.enum(['low', 'moderate', 'high']),
  stepGoal: z.number().int().min(0).max(50000).nullable().optional(),
});

export const onboardingNutritionSchema = z.object({
  eatingPattern: z.enum(['no_preference', 'vegetarian', 'vegan', 'pescatarian', 'other']),
  allergies: z.array(z.string().max(60)).max(20).default([]),
  avoidIngredients: z.array(z.string().max(60)).max(30).default([]),
  budgetLevel: z.enum(['low', 'moderate', 'flexible']),
  cookingTime: z.enum(['minimal', 'some', 'enjoy_cooking']),
  mealCount: z.number().int().min(1).max(6),
  mealTiming: z.string().max(500).optional(),
  trackingDetail: z.enum(['coarse', 'moderate', 'detailed']),
});

export const onboardingSafetySchema = z.object({
  acknowledgedNoDiagnosis: z
    .boolean()
    .refine((v) => v, 'Please confirm you understand this is not a medical service'),
  acknowledgedProfessionalHelp: z
    .boolean()
    .refine((v) => v, 'Please confirm you will seek professional help for pain or injury'),
});
