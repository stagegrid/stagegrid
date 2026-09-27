export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://stagegrid:stagegrid@localhost:54329/stagegrid_test'

export const TEST_CONFIG = {
  appUrl: 'http://localhost:4000',
  appSecret: 'test-secret-test-secret-test-secret-42',
  sessionTtlDays: 30,
} as const
