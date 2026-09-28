import type { Logger } from 'pino'

import type { Config } from '../config/config'
import type { Database } from '../db/client'
import type { SseHub } from '../realtime/hub'
import type { Actor } from '../services/context'
import type { RateLimiter } from './middleware/rate-limit'

export interface AppDeps {
  database: Database
  config: Config
  logger: Logger
  hub: SseHub
  now: () => Date
  loginLimiter: RateLimiter
  publicLimiter: RateLimiter
  /** Directory containing the built admin SPA; omitted in tests. */
  staticDir?: string
}

export interface AuthState {
  actor: Actor
  sessionId: string | null
  via: 'cookie' | 'bearer'
}

export interface AppEnv {
  Variables: {
    requestId: string
    auth: AuthState | null
    deps: AppDeps
  }
}
