import { execFileSync, spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('a stage follows its tasks: accept to finish, reopen with a reason to rework', async ({
  page,
}) => {
  test.setTimeout(120_000)
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

  // A stand-in for `claude`: edits and commits in the worktree, then answers in Claude's format.
  const fake = join(dir, 'claude')
  await writeFile(
    fake,
    `#!${process.execPath}
const { execSync } = require('node:child_process')
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n')
const args = process.argv.slice(2)
const prompt = args[args.length - 1]
if (prompt.includes('Slot booking') && !args.includes('--resume')) {
  out({ type: 'result', subtype: 'success', is_error: false, structured_output: { status: 'needs_answers', summary: 'Two rules are unclear', commit: null, tests: null, questions: [
    { prompt: 'Reject the second booking?', options: ['Yes', 'No'] },
    { prompt: 'Slot length in minutes?', options: [] },
  ] } })
  process.exit(0)
}
require('node:fs').writeFileSync('login.txt', 'email login\\n')
execSync('git add -A && git commit -q -m "feat: email login"')
const commit = execSync('git rev-parse HEAD').toString().trim()
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Implemented email login' }] } })
out({ type: 'result', subtype: 'success', is_error: false, structured_output: { status: 'submitted', summary: 'Work done', commit, tests: '3 passed', questions: [] } })
`,
  )
  await chmod(fake, 0o755)
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
  config.providers = { claude_code: { bin: fake } }
  await writeFile(configPath, JSON.stringify(config))

  const worker = spawn(
    process.execPath,
    ['packages/runner/dist/cli.js', 'start', '--config', configPath],
    {
      stdio: ['ignore', openSync(`${dir}/runner.log`, 'w'), openSync(`${dir}/runner.log`, 'a')],
    },
  )
  try {
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
  } finally {
    worker.kill('SIGINT')
  }
})
