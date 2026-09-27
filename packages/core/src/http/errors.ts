import { ERROR_STATUS, type ErrorCode } from '@stagegrid/shared'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

import { AppError } from '../errors'
import type { AppEnv } from './env'

export function errorResponse(
  c: Context<AppEnv>,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId: c.get('requestId'),
      },
    },
    ERROR_STATUS[code] as ContentfulStatusCode,
  )
}

export function handleError(err: Error, c: Context<AppEnv>) {
  if (err instanceof AppError) return errorResponse(c, err.code, err.message, err.details)
  if (err instanceof ZodError) {
    return errorResponse(c, 'validation_error', 'Request is invalid', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  if (err.name === 'SyntaxError')
    return errorResponse(c, 'validation_error', 'Request body is not valid JSON')
  c.get('deps')?.logger.error({ err, requestId: c.get('requestId') }, 'unhandled error')
  return errorResponse(c, 'internal', 'Something went wrong')
}
