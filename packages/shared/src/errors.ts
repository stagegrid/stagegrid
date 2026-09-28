export const ERROR_CODES = [
  'validation_error',
  'unauthenticated',
  'forbidden',
  'not_found',
  'ambiguous_ref',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export const ERROR_STATUS: Record<ErrorCode, number> = {
  validation_error: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  ambiguous_ref: 409,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  internal: 500,
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
    requestId?: string
  }
}
