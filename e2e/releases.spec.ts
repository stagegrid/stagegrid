import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

// Runs after board/details/mcp specs (name order). Items: Login, Reports.
test('plan a release: target, scope, board filter, mark released', async ({ page }) => {
  await signIn(page)
  await page.goto('/p/clinic-os')
  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Releases' })
    .click()
  await page.getByRole('button', { name: 'Create release' }).first().click()
  await page.getByLabel('Name').fill('v1.2')
  await page.getByLabel('Target date (go-live)').fill('2027-01-15')
  await page.getByRole('dialog').getByRole('button', { name: 'Create release' }).click()
  await expect(page.getByRole('heading', { name: 'v1.2' })).toBeVisible()
  await expect(page.getByText('Planned', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Add items' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Change' }).click()
  await dialog.getByRole('group', { name: 'Stages to redo' }).getByText('Design').click()
  await dialog.getByRole('list', { name: 'Items' }).getByText('Login').click()
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText('Reopens (done → to do): Login › Design')).toBeVisible()
  await dialog.getByRole('button', { name: /^Add 1 item/ }).click()

  const scope = page.getByRole('table', { name: 'Release scope' })
  await expect(scope.getByText('Change')).toBeVisible()
  await expect(scope.getByTitle('Design: To do')).toBeVisible()

  await page.getByRole('link', { name: 'Open in board' }).click()
  await expect(page).toHaveURL(/release=/)
  await expect(page.getByRole('rowheader')).toHaveCount(1)
  await expect(page.getByRole('rowheader').getByText('v1.2')).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Timeline' })
    .click()
  await page.getByLabel('Show release').click()
  await page.getByRole('option', { name: 'Release v1.2' }).click()
  await expect(page.getByTitle('Go-live 2027-01-15')).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Releases' })
    .click()
  await page.getByRole('link', { name: /v1\.2/ }).click()
  await page.getByRole('button', { name: 'Mark released' }).click()
  await expect(page.getByText(/cells? (isn't|aren't) done/)).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark released' }).click()
  await expect(page.getByText('Released', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('What shipped')).toBeVisible()
})
