import { describe, expect, it } from 'vitest'

import { scaffoldFiles } from './files'

describe('scaffoldFiles', () => {
  it('writes a runnable project with a random secret', () => {
    const a = scaffoldFiles({ name: 'my-pm', coreVersion: '0.1.0', db: 'docker' })
    const b = scaffoldFiles({ name: 'my-pm', coreVersion: '0.1.0', db: 'docker' })
    expect(Object.keys(a).sort()).toEqual([
      '.env',
      '.env.example',
      '.gitignore',
      'Dockerfile',
      'README.md',
      'docker-compose.yml',
      'package.json',
    ])
    expect(JSON.parse(a['package.json']!)).toMatchObject({
      name: 'my-pm',
      dependencies: { '@stagegrid/core': '^0.1.0' },
    })
    const secret = /APP_SECRET=(.+)/.exec(a['.env']!)![1]!
    expect(secret.length).toBeGreaterThanOrEqual(48)
    expect(a['.env']).not.toBe(b['.env'])
    expect(a['.env']).toContain(
      'DATABASE_URL=postgres://stagegrid:stagegrid@localhost:5432/stagegrid',
    )
  })
  it('uses the given database URL', () => {
    const f = scaffoldFiles({
      name: 'x',
      coreVersion: '0.1.0',
      db: 'url',
      databaseUrl: 'postgres://u:p@db.example:5432/pm',
    })
    expect(f['.env']).toContain('DATABASE_URL=postgres://u:p@db.example:5432/pm')
    expect(f['README.md']).not.toContain('docker compose up -d db')
  })
})
