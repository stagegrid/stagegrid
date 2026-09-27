import { describe, expect, it } from 'vitest'

import { hashPassword } from '../../src/lib/crypto'
import {
  acceptToken,
  authenticateSession,
  changePassword,
  login,
  logout,
  setup,
  tokenInfo,
} from '../../src/services/auth.service'
import { getInstanceSettings, needsSetup } from '../../src/services/settings.service'
import { createInviteLink, createResetLink, inviteUser } from '../../src/services/users.service'
import { useTestDatabase } from '../helpers/db'
import { TEST_CONFIG } from '../helpers/env'
import { createUser, FIXED_NOW, makeCtx } from '../helpers/factories'

const getDb = useTestDatabase()
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!

describe('setup', () => {
  const input = {
    name: 'Pond',
    email: 'pond@example.com',
    password: 'correct horse battery',
    instanceName: 'Acme PM',
    timezone: 'Asia/Bangkok',
  }

  it('creates the first admin, settings, and a session', async () => {
    const db = getDb()
    expect(await needsSetup(db.db)).toBe(true)
    const res = await setup(makeCtx(db, null), input)
    expect(res.user).toMatchObject({ email: 'pond@example.com', isAdmin: true, status: 'active' })
    expect(await needsSetup(db.db)).toBe(false)
    expect(await getInstanceSettings(db.db)).toMatchObject({
      instanceName: 'Acme PM',
      timezone: 'Asia/Bangkok',
    })
    const auth = await authenticateSession(db.db, TEST_CONFIG, res.sessionToken, FIXED_NOW)
    expect(auth?.actor).toMatchObject({ userId: res.user.id, isAdmin: true })
  })

  it('refuses a second setup', async () => {
    const db = getDb()
    await setup(makeCtx(db, null), input)
    await expect(
      setup(makeCtx(db, null), { ...input, email: 'other@example.com' }),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})

describe('login / sessions', () => {
  it('logs in active users and rejects everything else with the same error', async () => {
    const db = getDb()
    const passwordHash = await hashPassword('correct horse battery')
    await createUser(db, { email: 'a@example.com', passwordHash })
    await createUser(db, { email: 'd@example.com', passwordHash, status: 'disabled' })
    const ctx = makeCtx(db, null)
    const ok = await login(ctx, { email: 'a@example.com', password: 'correct horse battery' })
    expect(ok.user.email).toBe('a@example.com')
    for (const attempt of [
      { email: 'a@example.com', password: 'wrong password' },
      { email: 'missing@example.com', password: 'correct horse battery' },
      { email: 'd@example.com', password: 'correct horse battery' },
    ]) {
      await expect(login(ctx, attempt)).rejects.toMatchObject({
        code: 'unauthenticated',
        message: 'Email or password is incorrect',
      })
    }
  })

  it('expires sessions and slides expiry after an hour of use', async () => {
    const db = getDb()
    const passwordHash = await hashPassword('correct horse battery')
    await createUser(db, { email: 'a@example.com', passwordHash })
    const { sessionToken } = await login(makeCtx(db, null), {
      email: 'a@example.com',
      password: 'correct horse battery',
    })
    const day = 86_400_000
    expect(
      await authenticateSession(
        db.db,
        TEST_CONFIG,
        sessionToken,
        new Date(FIXED_NOW.getTime() + 29 * day),
      ),
    ).not.toBeNull()
    // the call above slid expiry to +29d+30d, so +58d is still valid
    expect(
      await authenticateSession(
        db.db,
        TEST_CONFIG,
        sessionToken,
        new Date(FIXED_NOW.getTime() + 58 * day),
      ),
    ).not.toBeNull()
    expect(
      await authenticateSession(
        db.db,
        TEST_CONFIG,
        sessionToken,
        new Date(FIXED_NOW.getTime() + 200 * day),
      ),
    ).toBeNull()
  })

  it('logout removes the session', async () => {
    const db = getDb()
    const passwordHash = await hashPassword('correct horse battery')
    await createUser(db, { email: 'a@example.com', passwordHash })
    const ctx = makeCtx(db, null)
    const { sessionToken } = await login(ctx, {
      email: 'a@example.com',
      password: 'correct horse battery',
    })
    await logout(ctx, sessionToken)
    expect(await authenticateSession(db.db, TEST_CONFIG, sessionToken, FIXED_NOW)).toBeNull()
  })
})

describe('invites and resets', () => {
  it('invite link activates the user once and a new link voids the old one', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const ctx = makeCtx(db, admin)
    const invited = await inviteUser(ctx, { name: 'Bee', email: 'bee@example.com', isAdmin: false })
    expect(invited.user.status).toBe('invited')
    const second = await createInviteLink(ctx, invited.user.id)
    await expect(tokenInfo(ctx, tokenOf(invited.link))).rejects.toMatchObject({ code: 'not_found' })
    expect(await tokenInfo(ctx, tokenOf(second.link))).toEqual({
      kind: 'invite',
      email: 'bee@example.com',
      name: 'Bee',
    })

    const res = await acceptToken(makeCtx(db, null), {
      token: tokenOf(second.link),
      name: 'Bee B',
      password: 'new password 123',
    })
    expect(res.user).toMatchObject({ name: 'Bee B', status: 'active' })
    await expect(
      acceptToken(makeCtx(db, null), { token: tokenOf(second.link), password: 'new password 123' }),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      inviteUser(ctx, { name: 'Dup', email: 'BEE@example.com', isAdmin: false }),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('invite links expire after 7 days', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const invited = await inviteUser(makeCtx(db, admin), {
      name: 'Bee',
      email: 'bee@example.com',
      isAdmin: false,
    })
    const later = makeCtx(db, null, new Date(FIXED_NOW.getTime() + 7 * 86_400_000 + 1))
    await expect(tokenInfo(later, tokenOf(invited.link))).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('reset link sets a new password and signs out other sessions', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const passwordHash = await hashPassword('old password 123')
    const user = await createUser(db, { email: 'u@example.com', passwordHash })
    const old = await login(makeCtx(db, null), {
      email: 'u@example.com',
      password: 'old password 123',
    })
    const reset = await createResetLink(makeCtx(db, admin), user.userId)
    await acceptToken(makeCtx(db, null), { token: tokenOf(reset.link), password: 'brand new pass' })
    expect(await authenticateSession(db.db, TEST_CONFIG, old.sessionToken, FIXED_NOW)).toBeNull()
    await expect(
      login(makeCtx(db, null), { email: 'u@example.com', password: 'brand new pass' }),
    ).resolves.toBeTruthy()
  })
})

describe('changePassword', () => {
  it('requires the current password and keeps only the current session', async () => {
    const db = getDb()
    const passwordHash = await hashPassword('old password 123')
    const user = await createUser(db, { email: 'u@example.com', passwordHash })
    const s1 = await login(makeCtx(db, null), {
      email: 'u@example.com',
      password: 'old password 123',
    })
    const s2 = await login(makeCtx(db, null), {
      email: 'u@example.com',
      password: 'old password 123',
    })
    const current = await authenticateSession(db.db, TEST_CONFIG, s1.sessionToken, FIXED_NOW)
    const ctx = makeCtx(db, user)
    await expect(
      changePassword(ctx, current!.sessionId, {
        currentPassword: 'nope',
        newPassword: 'new password 1',
      }),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    await changePassword(ctx, current!.sessionId, {
      currentPassword: 'old password 123',
      newPassword: 'new password 1',
    })
    expect(await authenticateSession(db.db, TEST_CONFIG, s1.sessionToken, FIXED_NOW)).not.toBeNull()
    expect(await authenticateSession(db.db, TEST_CONFIG, s2.sessionToken, FIXED_NOW)).toBeNull()
  })
})
