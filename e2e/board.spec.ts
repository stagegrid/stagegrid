import { expect, test } from '@playwright/test'

import { ADMIN, signIn } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('first run: setup, create a project, add items', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup/)
  await page.getByLabel('Your name').fill(ADMIN.name)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Create admin account' }).click()
  await expect(page).toHaveURL(/\/projects/)

  await page.getByRole('button', { name: 'Create project' }).first().click()
  await page.getByLabel('Name').fill('Clinic OS')
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/p\/clinic-os/)

  await page.getByRole('button', { name: 'Add items' }).click()
  await page.getByLabel('Names').fill('Login\nReports')
  await page.getByRole('button', { name: 'Add 2 items' }).click()
  await expect(page.getByRole('rowheader').filter({ hasText: 'Login' })).toBeVisible()
  await expect(page.getByText('Items: 2')).toBeVisible()
})

test('changing a cell updates the board, and another browser sees it live', async ({
  page,
  browser,
}) => {
  await signIn(page)
  await page.goto('/p/clinic-os')

  const other = await browser.newPage()
  await signIn(other)
  await other.goto('/p/clinic-os')
  await expect(other.getByRole('button', { name: 'Login, Design: To do' })).toBeVisible()

  await page.getByRole('button', { name: 'Login, Design: To do' }).click()
  await page.getByRole('radio', { name: /Done/ }).click()
  await page.getByLabel('Reason').fill('signed off')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Login, Design: Done' })).toBeVisible()

  // The other browser gets it over SSE without reloading.
  await expect(other.getByRole('button', { name: 'Login, Design: Done' })).toBeVisible({
    timeout: 2000,
  })
  await other.close()
})

test('cell history shows who changed it and why', async ({ page }) => {
  await signIn(page)
  await page.goto('/p/clinic-os')
  await page.getByRole('button', { name: 'Login, Design: Done' }).click()
  await expect(page.getByText('To do → Done')).toBeVisible()
  await expect(page.getByText('signed off')).toBeVisible()
})
