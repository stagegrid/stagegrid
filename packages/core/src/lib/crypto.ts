import { createHmac, randomBytes } from 'node:crypto'

import { hash, verify } from '@node-rs/argon2'

/** 32 random bytes, base64url, with an optional prefix such as `sg_pat_`. */
export function randomToken(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url')
}

/** Tokens are stored as HMAC-SHA256(APP_SECRET, token) so a DB leak alone can't be replayed. */
export function hashToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('base64url')
}

export function hashPassword(password: string): Promise<string> {
  return hash(password)
}

let dummyHash: Promise<string> | null = null

/** Verifies a password; with a null hash it still burns the same time to avoid a user-exists timing oracle. */
export async function verifyPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  if (passwordHash === null) {
    dummyHash ??= hash('stagegrid-dummy-password')
    await verify(await dummyHash, password).catch(() => false)
    return false
  }
  return verify(passwordHash, password).catch(() => false)
}
