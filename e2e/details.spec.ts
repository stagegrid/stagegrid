import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

// Uses "Reports" from board.spec.ts; leaves Login untouched for mcp.spec.ts.
test('cell details: assignee, planned date, link, comment, filter by person', async ({ page }) => {
  await signIn(page)
  await page.goto('/p/clinic-os')
  await page.getByRole('button', { name: 'Reports, Design: To do' }).click()

  const assignee = page.getByLabel('Add assignee')
  await assignee.fill('Somchai (Jira)')
  await assignee.press('Enter')
  await expect(page.getByText('Somchai (Jira)').first()).toBeVisible()

  await page.getByLabel('Planned end').fill('2026-01-01')
  await page.getByLabel('Planned start').click()

  await page.getByRole('button', { name: 'Add link' }).click()
  await page.getByLabel('Link title').fill('Report spec')
  await page.getByLabel('Link URL').fill('https://docs.example.com/report')
  await page.getByRole('button', { name: 'Add link' }).click()
  await expect(page.getByRole('link', { name: /Report spec/ })).toBeVisible()

  await page.getByLabel('New comment').fill('Waiting for **finance** sign-off')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByText('finance')).toBeVisible()
  await page.keyboard.press('Escape')

  // Past planned end → needs update; comment and doc link are listed in the cell label via icons
  await expect(
    page.getByRole('button', { name: 'Reports, Design: To do, needs update' }),
  ).toBeVisible()
  await expect(
    page.getByRole('rowheader').filter({ hasText: 'Reports' }).getByTitle('Somchai (Jira)'),
  ).toBeVisible()

  await page.getByLabel('Filter by assignee').click()
  await page.getByRole('option', { name: 'Somchai (Jira)' }).click()
  await expect(page.getByRole('rowheader')).toHaveCount(1)
  await expect(page).toHaveURL(/who=name%3Asomchai/)
})
