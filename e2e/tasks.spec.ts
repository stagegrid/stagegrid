import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { fakeClaude, fakeCodex } from './fake-agents'
import { signIn } from './fixtures'

test.describe.configure({ mode: 'serial' })

// The login limiter allows few sign-ins per run, so every test here shares one signed-in page.
let page: Page
let runnerState: {
  dir: string
  configPath: string
  repo: string
  startWorker: () => ChildProcess
  worker: ChildProcess
} | null = null

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await signIn(page)
})

test.afterAll(async () => {
  runnerState?.worker.kill('SIGINT')
  await page.close()
})

test('a stage follows its tasks: accept to finish, reopen with a reason to rework', async () => {
  test.setTimeout(120_000)
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
  await expect(page.getByRole('button', { name: 'Start run' })).toBeVisible()

  // A runner: enrol it with a token from the Runners page, point it at a repo, and let it do the work.
  await page.goto('/admin/runners')
  await page.getByRole('button', { name: 'Add runner' }).first().click()
  await page.getByLabel('Name', { exact: true }).fill('e2e-box')
  await page.getByRole('dialog').getByRole('checkbox').first().click()
  await page.getByRole('button', { name: 'Create token' }).click()
  const command = await page.getByLabel('Enrollment command', { exact: true }).textContent()
  const token = /--token (\S+)/.exec(command ?? '')![1]!
  await page.getByRole('button', { name: 'Done' }).click()

  const dir = await mkdtemp(join(tmpdir(), 'sg-e2e-runner-'))
  const configPath = join(dir, 'config.json')
  const runner = (...args: string[]) =>
    execFileSync(
      process.execPath,
      ['packages/runner/dist/cli.js', ...args, '--config', configPath],
      {
        encoding: 'utf8',
      },
    )
  runner('enroll', '--url', 'http://localhost:4173', '--token', token)

  const repo = join(dir, 'clinic-os')
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo })
  execFileSync('git', ['init', '-b', 'main', repo])
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  await writeFile(join(repo, 'README.md'), 'clinic\n')
  git('add', '.')
  git('commit', '-m', 'init')
  runner('repo', 'clinic-os', repo, '--test', 'test -f login.txt')

  // Stand-ins for `claude` and `codex` that behave like the real ones would for each role.
  const fake = join(dir, 'claude')
  await writeFile(fake, fakeClaude(process.execPath))
  const fakeCodexBin = join(dir, 'codex')
  await writeFile(fakeCodexBin, fakeCodex(process.execPath))
  await chmod(fakeCodexBin, 0o755)
  await chmod(fake, 0o755)
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
  config.providers = { claude_code: { bin: fake }, codex: { bin: fakeCodexBin } }
  config.codexHome = join(dir, 'codex-home')
  await writeFile(configPath, JSON.stringify(config))

  const startWorker = () =>
    spawn(process.execPath, ['packages/runner/dist/cli.js', 'start', '--config', configPath], {
      env: { ...process.env, FAKE_STATE_DIR: dir },
      stdio: ['ignore', openSync(`${dir}/runner.log`, 'a'), openSync(`${dir}/runner.log`, 'a')],
    })
  runnerState = { dir, configPath, repo, startWorker, worker: startWorker() }
  {
    await expect(async () => {
      await page.goto('/admin/runners')
      await expect(page.getByText('e2e-box')).toBeVisible()
      await expect(page.getByText('Online', { exact: true })).toBeVisible()
    }).toPass({ timeout: 15_000 })

    await page.goto('/p/clinic-os/tasks')
    await page.getByRole('button', { name: /^Email login/ }).click()
    await page.getByRole('button', { name: 'Start run' }).click()
    // The run finishes on the runner; the sheet updates by itself.
    await expect(page.getByText('Finished', { exact: true })).toBeVisible({ timeout: 25_000 })
    // The delivery shows the commit and who ran which check; accepting is bound to that commit.
    await expect(
      page.getByRole('region', { name: 'Delivery' }).getByText('Run by the runner'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Accept this version' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: 'Done' }).getByText('Email login')).toBeVisible()
    expect(git('branch', '--list', 'stagegrid/*').toString()).toMatch(/stagegrid\/task-/)

    // A second task whose employee has to ask before it can start: questions, answers, continuation.
    await page.goto('/p/clinic-os/tasks')
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('Item').click()
    await page.getByRole('option', { name: 'Login' }).click()
    await page.getByLabel('Stage').click()
    await page.getByRole('option', { name: 'Implement' }).click()
    await page.getByLabel('Assign to').click()
    await page.getByRole('option', { name: /Mali/ }).click()
    await page.getByLabel('Title').fill('Slot booking')
    await page.getByRole('button', { name: /create task/i }).click()
    await page.getByRole('button', { name: /^Slot booking/ }).click()
    await page.getByRole('button', { name: 'Pin context' }).click()
    await page.getByLabel('Decisions').fill('Bookings are in 15 to 60 minute slots')
    await page.getByRole('dialog').getByRole('button', { name: 'Pin context' }).click()
    await expect(page.getByText('Revision 1')).toBeVisible()
    await page.getByRole('button', { name: 'Mark ready' }).click()
    await page.getByRole('button', { name: 'Start run' }).click()

    await expect(page.getByText('Questions · 2 to answer')).toBeVisible({ timeout: 25_000 })
    await page.keyboard.press('Escape')
    const attention = page.getByRole('region', { name: 'Needs your attention' })
    await expect(attention.getByText('Slot booking')).toBeVisible()
    await attention.getByRole('button', { name: /Slot booking/ }).click()

    await page.getByRole('button', { name: 'Yes', exact: true }).click()
    await page.getByRole('button', { name: 'Answer', exact: true }).first().click()
    await expect(page.getByText('Questions · 1 to answer')).toBeVisible()
    await page.getByLabel('Answer to: Slot length in minutes?').fill('30')
    await page.getByRole('button', { name: 'Answer', exact: true }).click()
    await expect(page.getByText('Finished', { exact: true })).toBeVisible({ timeout: 25_000 })
    await expect(
      page.getByRole('region', { name: 'Conversation' }).getByText('Reject the second booking?'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Accept this version' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
  }
})

test('a team takes an item from requirements to tested work, with a person accepting every stage', async () => {
  test.setTimeout(300_000)
  const origin = 'http://localhost:4173'
  const api = (path: string, data?: unknown) =>
    page.request.fetch(`/api/v1${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      data,
      headers: { origin },
    })
  expect((await api('/projects/clinic-os/items', { items: [{ name: 'Bookings' }] })).status()).toBe(
    201,
  )

  // The team: an analyst and a QA on Claude Code, a reviewer on Codex next to Mali the developer.
  await page.goto('/p/clinic-os/settings')
  for (const [name, role, provider] of [
    ['Nok', 'Analyst', 'Claude Code'],
    ['Ploy', 'Reviewer', 'Codex'],
    ['Beam', 'QA', 'Claude Code'],
  ]) {
    await page.getByRole('button', { name: 'New employee' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill(name!)
    await dialog.getByLabel('Role').click()
    await page.getByRole('option', { name: role!, exact: true }).click()
    await dialog.getByLabel('Runs on').click()
    await page.getByRole('option', { name: provider!, exact: true }).click()
    await dialog.getByRole('button', { name: 'Create employee' }).click()
    await expect(page.getByText(name!, { exact: true })).toBeVisible()
  }
  const pick = async (id: string, person: string) => {
    await page.locator(`#${id}`).click()
    await page.getByRole('option', { name: new RegExp(`^${person} ·`) }).click()
  }
  await page.getByRole('checkbox', { name: /Draft requirement documents/ }).click()
  await pick('team-analyst', 'Nok')
  await pick('team-dev', 'Mali')
  await page.getByRole('checkbox', { name: /Review Dev's work/ }).click()
  await pick('team-reviewer', 'Ploy')
  await page.getByRole('checkbox', { name: /Test accepted work/ }).click()
  await pick('team-qa', 'Beam')
  await page.getByRole('button', { name: 'Save team' }).click()
  await expect
    .poll(
      async () =>
        (
          (await (await api('/projects/clinic-os')).json()) as {
            team: { qa: { enabled: boolean } }
          }
        ).team.qa.enabled,
    )
    .toBe(true)

  const card = (title: string) => page.getByRole('button', { name: new RegExp(`^${title}`) })
  const startWork = async () => {
    await page.getByRole('button', { name: 'Mark ready' }).click()
    await page.getByRole('button', { name: 'Start run' }).click()
  }
  const acceptThis = async () => {
    await page.getByRole('button', { name: 'Accept this version' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
    await page.keyboard.press('Escape')
  }

  // 1. The analyst drafts the requirements; accepting them approves that exact version.
  await page.goto('/p/clinic-os/tasks')
  await page.getByRole('button', { name: 'New task' }).click()
  await page.getByLabel('Item').click()
  await page.getByRole('option', { name: 'Bookings' }).click()
  await page.getByLabel('Stage').click()
  await page.getByRole('option', { name: 'Document' }).click()
  await page.getByLabel('Assign to').click()
  await page.getByRole('option', { name: /Nok/ }).click()
  await page.getByLabel('Title').fill('Requirements: Bookings')
  await page.getByRole('button', { name: /create task/i }).click()
  await card('Requirements: Bookings').click()
  await page.getByRole('button', { name: 'Pin context' }).click()
  await page.getByLabel('Decisions').fill('Bookings are made online')
  await page.getByRole('dialog').getByRole('button', { name: 'Pin context' }).click()
  await expect(page.getByText('Revision 1')).toBeVisible()
  await startWork()
  await expect(
    page.getByRole('region', { name: 'Delivery' }).getByText(/Requirement document, version 1/),
  ).toBeVisible({ timeout: 40_000 })
  await acceptThis()

  // 2. The developer's task appears by itself, ready to start because the requirements are approved.
  await expect(
    page.getByRole('region', { name: 'Draft' }).getByText('Implement Bookings'),
  ).toBeVisible()
  await card('Implement Bookings').click()
  await startWork()
  // The reviewer asks for changes once; the developer reworks; the reviewer passes the new commit.
  await expect(page.getByText('Sent back 1 time by a reviewer or QA.')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('button', { name: 'Accept this version' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(
    page.getByRole('region', { name: 'Delivery' }).getByText('Reviewer: passed'),
  ).toBeVisible()
  await acceptThis()

  // 3. QA gets its own task. It fails the accepted commit, so Implement reopens and QA waits.
  await expect(page.getByRole('region', { name: 'Draft' }).getByText('Test Bookings')).toBeVisible()
  await card('Test Bookings').click()
  await startWork()
  await expect(
    page.getByRole('status').filter({ hasText: 'Waiting for the new accepted commit' }),
  ).toBeVisible({
    timeout: 60_000,
  })
  await page.keyboard.press('Escape')
  await card('Implement Bookings').click()
  await expect(page.getByText('Sent back 2 times by a reviewer or QA.')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('button', { name: 'Accept this version' })).toBeVisible({
    timeout: 60_000,
  })
  await acceptThis()

  // 4. The same QA task is ready again for the new commit; it passes and a person accepts it.
  await expect(page.getByRole('region', { name: 'Draft' }).getByText('Test Bookings')).toBeVisible()
  await card('Test Bookings').click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Waiting for the new accepted commit' }),
  ).toHaveCount(0)
  await startWork()
  await expect(page.getByRole('region', { name: 'QA report' }).getByText('QA: passed')).toBeVisible(
    { timeout: 60_000 },
  )
  await acceptThis()

  await page.goto('/p/clinic-os')
  for (const stage of ['Document', 'Implement', 'QA'])
    await expect(page.getByRole('button', { name: `Bookings, ${stage}: Done` })).toBeVisible()
})
