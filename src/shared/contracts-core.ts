import { z } from 'zod';

export const LOCALES = ['en', 'nl', 'fr', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const localeSchema = z.enum(LOCALES);

export const GOAL_TYPES = [
  'muscle_gain',
  'fat_loss',
  'weight_loss',
  'fitness',
  'strength',
  'general_health',
  'consistent_routine',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export const goalTypeSchema = z.enum(GOAL_TYPES);

export const EXPERIENCE_LEVELS = ['new', 'returning', 'experienced'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const SKIP_REASONS = [
  'time',
  'equipment_unavailable',
  'discomfort',
  'too_difficult',
  'preference',
  'other',
  'no_reason',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const skipReasonSchema = z.enum(SKIP_REASONS);

export const PAIN_SEVERITIES = ['discomfort', 'pain', 'urgent'] as const;
export type PainSeverity = (typeof PAIN_SEVERITIES)[number];
export const painSeveritySchema = z.enum(PAIN_SEVERITIES);

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    field?: string;
    details?: Record<string, string>;
  };
};
