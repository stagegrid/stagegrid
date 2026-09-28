import { describe, expect, it } from 'vitest'

import {
  authenticateToken,
  createToken,
  listTokens,
  revokeToken,
} from '../../src/services/tokens.service'
import { updateUser } from '../../src/services/users.service'
import { useTestDatabase } from '../helpers/db'
import { TEST_CONFIG } from '../helpers/env'
import { createUser, FIXED_NOW, makeCtx } from '../helpers/factories'

const getDb = useTestDatabase()
const DAY = 86_400_000

describe('api tokens', () => {
  it('creates a token shown once, lists metadata only, and authenticates as the owner', async () => {
    const db = getDb()
    const user = await createUser(db, { name: 'Bee' })
    const ctx = makeCtx(db, user)
    const { token, meta } = await createToken(ctx, { name: 'Claude' })
    expect(token).toMatch(/^sg_pat_[\w-]{40,}$/)
    expect(meta).toMatchObject({ name: 'Claude', prefix: token.slice(0, 12), expiresAt: null })
    expect(await listTokens(ctx)).toEqual([
      expect.objectContaining({ id: meta.id, name: 'Claude' }),
    ])
    expect(JSON.stringify(await listTokens(ctx))).not.toContain(token)
    expect(await authenticateToken(db.db, TEST_CONFIG, token, FIXED_NOW, 'mcp')).toEqual({
      userId: user.userId,
      name: 'Bee',
      isAdmin: false,
      via: 'mcp',
    })
    expect((await listTokens(ctx))[0]!.lastUsedAt).toBe(FIXED_NOW.toISOString())
  })

  it('rejects unknown, revoked, expired tokens and disabled users', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const user = await createUser(db)
    const ctx = makeCtx(db, user)
    expect(await authenticateToken(db.db, TEST_CONFIG, 'sg_pat_nope', FIXED_NOW, 'mcp')).toBeNull()
    expect(await authenticateToken(db.db, TEST_CONFIG, 'not-a-token', FIXED_NOW, 'mcp')).toBeNull()

    const expiring = await createToken(ctx, { name: 'short', expiresInDays: 30 })
    expect(
      await authenticateToken(
        db.db,
        TEST_CONFIG,
        expiring.token,
        new Date(FIXED_NOW.getTime() + 29 * DAY),
        'mcp',
      ),
    ).not.toBeNull()
    expect(
      await authenticateToken(
        db.db,
        TEST_CONFIG,
        expiring.token,
        new Date(FIXED_NOW.getTime() + 31 * DAY),
        'mcp',
      ),
    ).toBeNull()

    const revoked = await createToken(ctx, { name: 'old' })
    await revokeToken(ctx, revoked.meta.id)
    expect(await authenticateToken(db.db, TEST_CONFIG, revoked.token, FIXED_NOW, 'mcp')).toBeNull()
    await expect(revokeToken(ctx, revoked.meta.id)).rejects.toMatchObject({ code: 'not_found' })

    const live = await createToken(ctx, { name: 'live' })
    await updateUser(makeCtx(db, admin), user.userId, { status: 'disabled' })
    expect(await authenticateToken(db.db, TEST_CONFIG, live.token, FIXED_NOW, 'mcp')).toBeNull()
  })

  it("can't revoke someone else's token", async () => {
    const db = getDb()
    const a = await createUser(db)
    const b = await createUser(db)
    const { meta } = await createToken(makeCtx(db, a), { name: 'mine' })
    await expect(revokeToken(makeCtx(db, b), meta.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})
