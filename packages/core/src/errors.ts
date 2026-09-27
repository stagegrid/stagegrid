import type { ErrorCode } from '@stagegrid/shared'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (message = 'Not found', details?: unknown) =>
  new AppError('not_found', message, details)
export const forbidden = (message = "You don't have permission to do that") =>
  new AppError('forbidden', message)
export const conflict = (message: string, details?: unknown) =>
  new AppError('conflict', message, details)
export const invalid = (message: string, details?: unknown) =>
  new AppError('validation_error', message, details)
export const unauthenticated = (message = 'Sign in to continue') =>
  new AppError('unauthenticated', message)
export const ambiguous = (message: string, details?: unknown) =>
  new AppError('ambiguous_ref', message, details)
