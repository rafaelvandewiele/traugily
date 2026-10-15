/**
 * Shared API contracts (single source of truth for client + server validation).
 * Schemas live in focused modules; this barrel is the public import path.
 */
export * from './contracts-core';
export * from './contracts-auth';
export * from './contracts-onboarding';
export * from './contracts-workout';
export * from './contracts-content';
export * from './domain-types';
