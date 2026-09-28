import pino from 'pino'

import type { Config } from '../../src/config/config'
import type { Database } from '../../src/db/client'
import { createApp } from '../../src/http/app'
import type { AppDeps } from '../../src/http/env'
import { createRateLimiter } from '../../src/http/middleware/rate-limit'
import { SseHub } from '../../src/realtime/hub'
import { TEST_CONFIG, TEST_DATABASE_URL } from './env'
import { FIXED_NOW } from './factories'

export const APP_ORIGIN = 'http://localhost:4000'

export function testConfig(): Config {
  return {
    ...TEST_CONFIG,
    databaseUrl: TEST_DATABASE_URL,
    appOrigin: APP_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    trustProxy: false,
    secureCookies: false,
  }
}

export function makeApp(database: Database, overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = {
    database,
    config: testConfig(),
    logger: pino({ level: 'silent' }),
    hub: new SseHub(),
    now: () => FIXED_NOW,
    loginLimiter: createRateLimiter(10, 15 * 60_000),
    publicLimiter: createRateLimiter(50, 15 * 60_000),
    ...overrides,
  }
  return { app: createApp(deps), deps }
}

type App = ReturnType<typeof makeApp>['app']

/** Tiny browser-like client: remembers the session cookie and sends the app Origin. */
export function browser(app: App) {
  let cookie = ''
  const call = async (
    method: string,
    path: string,
    json?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        origin: APP_ORIGIN,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    })
    const set = res.headers.get('set-cookie')
    if (set) {
      const m = /sg_session=([^;]*)/.exec(set)
      cookie = m && m[1] ? `sg_session=${m[1]}` : ''
    }
    return res
  }
  return {
    get: (p: string, h?: Record<string, string>) => call('GET', p, undefined, h),
    post: (p: string, json?: unknown, h?: Record<string, string>) => call('POST', p, json ?? {}, h),
    patch: (p: string, json: unknown) => call('PATCH', p, json),
    delete: (p: string) => call('DELETE', p),
    get cookie() {
      return cookie
    },
  }
}

export const SETUP_BODY = {
  name: 'Pond',
  email: 'pond@example.com',
  password: 'correct horse battery',
  instanceName: 'Acme',
  timezone: 'Asia/Bangkok',
}
