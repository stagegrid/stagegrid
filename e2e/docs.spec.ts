import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

// Runs after board/details specs (name order): the admin and "Clinic OS" exist.
test('templates, project selection, and a document from draft to Word', async ({
  page,
  baseURL,
}) => {
  await signIn(page)

  await page.goto('/admin/templates')
  await expect(
    page.getByRole('cell', { name: /Software Requirements Specification/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'New template' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Key').fill('screen-spec')
  await dialog.getByLabel('Name').fill('Screen spec')
  await dialog.getByLabel('Section 1 title').fill('Purpose')
  await dialog.getByLabel('Section 1 hint').fill('Why this screen exists')
  await dialog.getByRole('button', { name: 'Add section' }).click()
  await dialog.getByLabel('Section 2 title').fill('Fields')
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByRole('cell', { name: 'screen-spec' })).toBeVisible()

  await page.goto('/p/clinic-os/settings')
  await page.getByRole('checkbox', { name: /Business Requirements Document/ }).click()
  await page.getByRole('checkbox', { name: /Screen spec/ }).click()
  await page.getByRole('button', { name: 'Save templates' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // What the AI does over MCP (save_doc_draft), through the same service via REST.
  const res = await page.request.post('/api/v1/projects/clinic-os/documents', {
    headers: { origin: baseURL! },
    data: {
      template: 'brd',
      draft: { sections: { '1': 'ระบบจัดการคลินิก for **three** branches' } },
    },
  })
  expect(res.status()).toBe(201)

  await page.goto('/p/clinic-os')
  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Docs' })
    .click()
  await page.getByRole('link', { name: 'Business Requirements Document (BRD)' }).click()
  await expect(page.getByRole('heading', { name: '1 Executive summary' })).toBeVisible()
  await expect(page.getByText('ระบบจัดการคลินิก for three branches')).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Background and problem content').fill('Paper records are slow.')
  await page.getByRole('button', { name: 'Save new version' }).click()
  await expect(page.getByText('Saved as a new version')).toBeVisible()
  await page.getByRole('button', { name: 'Done editing' }).click()
  await expect(page.getByText('Paper records are slow.')).toBeVisible()
  await expect(page.getByLabel('Version')).toContainText('v2')

  await page.getByRole('button', { name: 'Download' }).click()
  const href = await page.getByRole('menuitem', { name: 'Word (.docx)' }).getAttribute('href')
  const docx = await page.request.get(href!)
  expect(docx.status()).toBe(200)
  expect(docx.headers()['content-disposition']).toMatch(/clinic-os-brd-v2-.*\.docx/)
  await page.keyboard.press('Escape')

  await page.goto(page.url().replace('/p/clinic-os/docs/', '/print/clinic-os/'))
  await expect(page.getByText('Paper records are slow.')).toBeVisible()
})
