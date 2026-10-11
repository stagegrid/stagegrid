import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('a stage follows its tasks: accept to finish, reopen with a reason to rework', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/p/clinic-os')
  await page.getByRole('button', { name: /^Reports, Deploy:/ }).click()

  await page.getByRole('button', { name: 'Manage with tasks' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Status' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add task' }).click()
  await page.getByLabel('Title').fill('Rollout script')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText('Rollout script')).toBeVisible()

  for (const [action, next] of [
    ['Mark ready', 'Start'],
    ['Start', 'Submit for acceptance'],
    ['Submit for acceptance', 'Accept'],
  ] as const) {
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(page.getByRole('button', { name: next, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Reports, Deploy: Done' })).toBeVisible()

  // The login limiter allows few sign-ins per run, so the Tasks tab is checked in the same session.
  await page.goto('/p/clinic-os/tasks')
  const done = page.getByRole('region', { name: 'Done' })
  await expect(done.getByText('Rollout script')).toBeVisible()
  await done.getByRole('button', { name: /Rollout script/ }).click()
  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeDisabled()
  await page.getByLabel('Reason').fill('Missing rollback step')
  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByText('Missing rollback step')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('region', { name: 'Changes requested' }).getByText('Rollout script'),
  ).toBeVisible()

  await page.goto('/p/clinic-os')
  await expect(
    page.getByRole('button', { name: 'Reports, Deploy: Doing, reworked once' }),
  ).toBeVisible()

  // AI employees: create one, assign a task, and see that it can't be ready without pinned context.
  await page.goto('/p/clinic-os/settings')
  await page.getByRole('button', { name: 'New employee' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Mali')
  await page.getByRole('button', { name: 'Create employee' }).click()
  await expect(page.getByText('Mali', { exact: true })).toBeVisible()

  await page.goto('/p/clinic-os/tasks')
  await page.getByRole('button', { name: 'New task' }).click()
  await page.getByLabel('Item').click()
  await page.getByRole('option', { name: 'Login' }).click()
  await page.getByLabel('Stage').click()
  await page.getByRole('option', { name: 'Implement' }).click()
  await page.getByLabel('Assign to').click()
  await page.getByRole('option', { name: /Mali/ }).click()
  await page.getByLabel('Title').fill('Email login')
  await page.getByRole('button', { name: /create task/i }).click()
  await page.getByRole('button', { name: /^Email login/ }).click()
  await expect(page.getByText("can't start until you pin the context")).toBeVisible()
  await page.getByRole('button', { name: 'Mark ready' }).click()
  await expect(page.getByText(/isn't ready/)).toBeVisible()

  await page.getByRole('button', { name: 'Pin context' }).click()
  await page.getByLabel('Decisions').fill('Email and password only')
  await page.getByRole('dialog').getByRole('button', { name: 'Pin context' }).click()
  await expect(page.getByText('Revision 1')).toBeVisible()
  await page.getByRole('button', { name: 'Mark ready' }).click()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
})
