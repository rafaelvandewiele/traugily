/** Consistent API error envelope + helpers. */

import type { ApiErrorBody } from '../../shared/contracts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    public details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.field ? { field: this.field } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (message: string, field?: string) =>
  new ApiError(400, 'bad_request', message, field);

export const unauthorized = (message = 'Please sign in to continue') =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);

export const conflict = (message: string, code = 'conflict') => new ApiError(409, code, message);

export const tooManyRequests = (message = 'Too many requests. Please wait and try again.') =>
  new ApiError(429, 'rate_limited', message);

export const serverError = (message = 'Something went wrong on our side. Your data is safe.') =>
  new ApiError(500, 'server_error', message);
