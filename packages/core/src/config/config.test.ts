import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from './config'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  APP_URL: 'https://pm.example.com/',
  APP_SECRET: 'x'.repeat(32),
}

describe('loadConfig', () => {
  it('applies defaults and derives origin/secure cookies', () => {
    const c = loadConfig(base)
    expect(c).toMatchObject({
      appUrl: 'https://pm.example.com',
      appOrigin: 'https://pm.example.com',
      port: 4000,
      host: '0.0.0.0',
      trustProxy: false,
      sessionTtlDays: 30,
      secureCookies: true,
    })
  })
  it('lists every problem', () => {
    expect(() => loadConfig({ APP_URL: 'nope', APP_SECRET: 'short' })).toThrowError(ConfigError)
    try {
      loadConfig({ APP_URL: 'nope', APP_SECRET: 'short' })
    } catch (e) {
      expect((e as Error).message).toContain('DATABASE_URL')
      expect((e as Error).message).toContain('APP_SECRET')
    }
  })
  it('parses TRUST_PROXY', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true)
  })
})
