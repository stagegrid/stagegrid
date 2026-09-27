import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

// details.spec.ts set Reports › Design planned end to 2026-01-01 (overdue); board.spec.ts finished Login › Design.
test('timeline shows plans, work rounds, and the burn-up', async ({ page }) => {
  await signIn(page)
  await page.goto('/p/clinic-os')
  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Timeline' })
    .click()
  await expect(page).toHaveURL(/\/p\/clinic-os\/timeline/)
  await expect(page.getByRole('heading', { name: 'Burn-up' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Design planned, overdue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Design round 1' })).toBeVisible()
  await page.getByRole('radio', { name: 'Week' }).click()
  await page.getByRole('button', { name: 'Design planned, overdue' }).click()
  await expect(page.getByText('Planned', { exact: true })).toBeVisible()
})
