import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must start with postgres://'),
  APP_URL: z.url(),
  APP_SECRET: z.string().min(32, 'must be at least 32 characters'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool,
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
})

export interface Config {
  databaseUrl: string
  /** Without trailing slash, e.g. https://pm.example.com */
  appUrl: string
  appOrigin: string
  appSecret: string
  port: number
  host: string
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL']
  trustProxy: boolean
  sessionTtlDays: number
  secureCookies: boolean
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`)
  }
  const e = parsed.data
  const url = new URL(e.APP_URL)
  return {
    databaseUrl: e.DATABASE_URL,
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    appOrigin: url.origin,
    appSecret: e.APP_SECRET,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    secureCookies: url.protocol === 'https:',
  }
}
