import { z } from 'zod';
import { localeSchema } from './contracts-core';

/* ------------------------------ Auth ------------------------------ */

export const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  locale: localeSchema.optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(10).max(256) });
export const forgotPasswordSchema = z.object({ email: z.string().email().max(254) });
export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(256),
  password: signupSchema.shape.password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: signupSchema.shape.password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  locale: localeSchema,
  unitSystem: z.enum(['metric', 'imperial']),
  timezone: z.string(),
  isAdmin: z.boolean(),
  isSupport: z.boolean(),
  entitlement: z.object({
    plan: z.enum(['free', 'premium']),
    status: z.enum(['free', 'trialing', 'active', 'past_due', 'canceled', 'expired']),
    validUntil: z.string().nullable(),
  }),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
