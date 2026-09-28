import { expect, type Page } from '@playwright/test'

/** Test-only credentials for the throwaway e2e database. */
export const ADMIN = { name: 'Pond', email: 'admin@stagegrid.test', password: 'e2e-password-123' }

export async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/projects/)
}
