import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClaimedRunDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { buildClaudeArgs, classifyClaude } from '../src/adapters/claude'
import { buildCodexArgs } from '../src/adapters/codex'
import {
  type AdapterInput,
  outcomeFromStructured,
  parseAnalystResult,
  parseQaResult,
  parseReviewResult,
} from '../src/adapters/types'
import { postReviewComment } from '../src/delivery'
import { rolePrompt, systemPromptFor, taskPrompt } from '../src/prompt'
import { ensureCheckout, git } from '../src/workspace'
import { fakeCli } from './helpers'

const input = (role: AdapterInput['role']): AdapterInput => ({
  cwd: '/work',
  prompt: 'Do it',
  systemPrompt: 'sys',
  model: null,
  sessionRef: null,
  env: {},
  gitDir: '/repo/.git',
  role,
})

describe('what each role may touch', () => {
  it('lets Dev edit and keeps everyone else read-only (Claude Code)', () => {
    const dev = buildClaudeArgs(input('dev'), 's', false, {})
    expect(dev[dev.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    for (const role of ['reviewer', 'qa', 'analyst'] as const) {
      const a = buildClaudeArgs(input(role), 's', false, {})
      expect(a[a.indexOf('--permission-mode') + 1]).toBe('dontAsk')
      const denied = a.slice(a.indexOf('--disallowedTools'), a.indexOf('--setting-sources'))
      expect(denied).toEqual(
        expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'Bash(git push*)']),
      )
      const allowed = a.slice(a.indexOf('--allowedTools'), a.indexOf('--disallowedTools'))
      expect(allowed).not.toContain('Edit')
      expect(allowed).not.toContain('Write')
    }
  })

  it('gives an analyst no shell at all, and a reviewer only git', () => {
    const analyst = buildClaudeArgs(input('analyst'), 's', false, {})
    expect(
      analyst.slice(analyst.indexOf('--allowedTools'), analyst.indexOf('--disallowedTools')),
    ).toEqual(['--allowedTools', 'Read', 'Grep', 'Glob'])
    expect(analyst.slice(analyst.indexOf('--disallowedTools'))).toContain('Bash')
    const reviewer = buildClaudeArgs(input('reviewer'), 's', false, {})
    expect(
      reviewer.slice(reviewer.indexOf('--allowedTools'), reviewer.indexOf('--disallowedTools')),
    ).toEqual(['--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git *)'])
  })

  it('asks Claude for the result shape of the role', () => {
    const schema = (role: AdapterInput['role']) => {
      const a = buildClaudeArgs(input(role), 's', false, {})
      return JSON.parse(a[a.indexOf('--json-schema') + 1]!) as {
        properties: Record<string, unknown>
      }
    }
    expect(Object.keys(schema('reviewer').properties)).toEqual(['verdict', 'summary', 'findings'])
    expect(Object.keys(schema('qa').properties)).toContain('results')
    expect(Object.keys(schema('analyst').properties)).toContain('documents')
    expect(Object.keys(schema('dev').properties)).toContain('commit')
  })

  it('runs Codex read-only for reviewers, QA and analysts', () => {
    for (const role of ['reviewer', 'qa', 'analyst'] as const) {
      const a = buildCodexArgs(input(role), '/s.json', false, null)
      expect(a[a.indexOf('-s') + 1]).toBe('read-only')
      expect(a).not.toContain('--add-dir')
      const resumed = buildCodexArgs({ ...input(role), sessionRef: 't' }, '/s.json', true, null)
      expect(resumed).toContain('sandbox_mode="read-only"')
    }
    expect(buildCodexArgs(input('dev'), '/s.json', false, null)).toEqual(
      expect.arrayContaining(['-s', 'workspace-write', '--add-dir']),
    )
  })
})

describe('reading what the agent concluded', () => {
  const ok = { type: 'result', subtype: 'success', is_error: false }

  it('turns a review into a verdict with findings', () => {
    const r = classifyClaude(
      {
        ...ok,
        structured_output: {
          verdict: 'changes_requested',
          summary: 'No lockout',
          findings: [
            { severity: 'major', text: 'Missing lockout', file: 'a.ts' },
            { severity: 'wat', text: 'odd', file: null },
          ],
        },
      },
      null,
      0,
      '',
      undefined,
      'reviewer',
    )
    expect(r).toEqual({
      kind: 'review',
      report: {
        verdict: 'changes_requested',
        summary: 'No lockout',
        findings: [
          { severity: 'major', text: 'Missing lockout', file: 'a.ts' },
          { severity: 'note', text: 'odd', file: null },
        ],
      },
    })
  })

  it('turns a QA report into verdict and per-criterion results', () => {
    const r = outcomeFromStructured(
      'qa',
      {
        verdict: 'fail',
        summary: 'Reset is broken',
        findings: [],
        results: [
          { criterion: 'Wrong password is rejected', result: 'pass', evidence: 'tried' },
          { criterion: 'Reset works', result: 'nonsense', evidence: '' },
        ],
      },
      null,
    )
    expect(r).toMatchObject({
      kind: 'qa',
      report: {
        verdict: 'fail',
        results: [{ result: 'pass' }, { criterion: 'Reset works', result: 'not_tested' }],
      },
    })
  })

  it('turns an analyst answer into documents, questions or a failure', () => {
    const docs = outcomeFromStructured(
      'analyst',
      {
        status: 'submitted',
        summary: 'Drafted',
        questions: [],
        documents: [
          {
            template: 'srs',
            title: 'SRS',
            sections: [{ id: '1.1', content: 'Text' }, { nope: 1 }],
          },
        ],
      },
      null,
    )
    expect(docs).toEqual({
      kind: 'analyst',
      summary: 'Drafted',
      documents: [{ template: 'srs', title: 'SRS', sections: [{ id: '1.1', content: 'Text' }] }],
    })
    expect(
      outcomeFromStructured(
        'analyst',
        {
          status: 'needs_answers',
          summary: 's',
          questions: [{ prompt: 'Who signs?', options: [] }],
          documents: [],
        },
        null,
      ),
    ).toMatchObject({ kind: 'needs_answers' })
    expect(
      outcomeFromStructured(
        'analyst',
        { status: 'submitted', summary: 's', questions: [], documents: [] },
        null,
      ),
    ).toMatchObject({ kind: 'failed' })
  })

  it("never takes a success without the role's shape", () => {
    for (const role of ['reviewer', 'qa', 'analyst', 'dev'] as const)
      expect(outcomeFromStructured(role, { status: 'done' }, null)).toMatchObject({
        kind: 'failed',
      })
    expect(parseReviewResult({ verdict: 'maybe' })).toBeNull()
    expect(parseQaResult(null)).toBeNull()
    expect(parseAnalystResult('x')).toBeNull()
  })
})

describe('prompts', () => {
  const claim = {
    run: {
      id: 'r',
      attempt: 1,
      fencingToken: 1,
      leaseExpiresAt: '',
      sessionRef: null,
      runtime: { provider: 'codex', model: null, instructions: '' },
    },
    project: { id: 'p', slug: 'pilot', name: 'Pilot' },
    employee: { id: 'e', displayName: 'Ploy', role: 'reviewer' },
    task: {
      id: 't',
      title: 'Email login',
      scope: 'Sign in',
      acceptanceCriteria: ['Wrong password is rejected'],
    },
    context: {
      revisionId: 'c',
      revisionNo: 1,
      createdAt: '',
      outdated: [],
      manifestHash: 'h',
      manifest: { schemaVersion: 1, documents: [], sources: [], decisions: ['Email only'] },
    },
    documents: [],
    delivery: { mode: 'pull_request', repo: 'acme/clinic' },
    role: 'reviewer',
    checkout: 'abc1234',
    examine: {
      headCommit: 'abc1234',
      summary: 'Built it',
      artifacts: [
        {
          artifactId: 'a',
          kind: 'pull_request',
          url: 'https://github.com/acme/clinic/pull/3',
          repo: 'acme/clinic',
          branch: 'b',
          headCommit: 'abc1234',
        },
      ],
      checks: [
        {
          command: 'pnpm test',
          exitCode: 0,
          commit: 'abc1234',
          source: 'runner_reported',
          output: null,
        },
      ],
    },
    feedback: [],
    analyst: null,
    answers: [],
  } as unknown as ClaimedRunDto

  it('tells a reviewer to judge, never to change or approve', () => {
    const sys = systemPromptFor('reviewer', 'Ploy', '')
    expect(sys).toContain('You never change code and never approve anything')
    const p = rolePrompt(claim, 'b')
    expect(p).toContain('The delivery you examine')
    expect(p).toContain('pull/3')
    expect(p).toContain('pnpm test: exit 0 (runner reported)')
  })

  it('gives the analyst the templates and the Dev the feedback to address', () => {
    const a = rolePrompt(
      {
        ...claim,
        role: 'analyst',
        analyst: {
          itemPath: 'Login',
          templates: [
            { key: 'srs', name: 'SRS', sections: [{ id: '1.1', number: '1.1', title: 'Purpose' }] },
          ],
        },
      } as ClaimedRunDto,
      'b',
    )
    expect(a).toContain('key: srs')
    expect(a).toContain('- 1.1: 1.1 Purpose')
    const dev = taskPrompt(
      {
        ...claim,
        feedback: [
          {
            source: 'qa',
            summary: 'Reset broken',
            findings: [{ severity: 'blocker', text: 'No email', file: null }],
          },
        ],
      } as ClaimedRunDto,
      'b',
    )
    expect(dev).toContain('Feedback to address')
    expect(dev).toContain('From QA: Reset broken')
    expect(dev).toContain('[blocker] No email')
  })
})

describe('ensureCheckout', () => {
  it('gives a fresh detached checkout of exactly one commit, apart from the Dev branch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-co-'))
    const g = (...a: string[]) =>
      execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString().trim()
    g('init', '-b', 'main')
    g('config', 'user.email', 't@example.com')
    g('config', 'user.name', 'T')
    await writeFile(join(dir, 'a.txt'), 'one\n')
    g('add', '.')
    g('commit', '-m', 'one')
    const first = g('rev-parse', 'HEAD')
    await writeFile(join(dir, 'a.txt'), 'two\n')
    g('commit', '-am', 'two')
    const opts = {
      repoPath: dir,
      worktreesDir: await mkdtemp(join(tmpdir(), 'sg-wt-')),
      projectSlug: 'pilot',
      taskId: '0192f3c4-aaaa-7bbb-8ccc-ddddeeeeffff',
      role: 'reviewer',
    }
    const co = await ensureCheckout({ ...opts, commit: first })
    expect(await readFile(join(co.path, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await git(['branch', '--show-current'], co.path)).toBe('')
    expect(co.commit).toBe(first)
    // Reusing it resets whatever the agent left behind.
    await writeFile(join(co.path, 'junk.txt'), 'x')
    const again = await ensureCheckout({ ...opts, commit: first })
    expect(again.path).toBe(co.path)
    expect(existsSync(join(co.path, 'junk.txt'))).toBe(false)
    await expect(ensureCheckout({ ...opts, commit: 'deadbeef' })).rejects.toThrow(/isn't in/)
  })
})

describe('postReviewComment', () => {
  it('leaves a comment on the pull request and never an approval', async () => {
    const log = join(await mkdtemp(join(tmpdir(), 'sg-gh-')), 'calls.log')
    const { bin } = await fakeCli(
      'gh',
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n')`,
    )
    const claim = {
      delivery: { mode: 'pull_request' },
      examine: {
        headCommit: 'abc1234def',
        artifacts: [{ kind: 'pull_request', url: 'https://github.com/acme/clinic/pull/3' }],
      },
    } as unknown as ClaimedRunDto
    await postReviewComment({
      claim,
      report: {
        verdict: 'changes_requested',
        summary: 'No lockout',
        findings: [{ severity: 'major', text: 'Missing lockout', file: 'a.ts' }],
      },
      config: { ghBin: bin },
    })
    const calls = await readFile(log, 'utf8')
    expect(calls).toMatch(/^pr comment https:\/\/github.com\/acme\/clinic\/pull\/3 --body /)
    expect(calls).toContain('Missing lockout')
    expect(calls).not.toMatch(/review|approve|merge/)
    // Nothing happens for a project that doesn't use pull requests.
    await postReviewComment({
      claim: { ...claim, delivery: { mode: 'local' } } as ClaimedRunDto,
      report: { verdict: 'pass', summary: '', findings: [] },
      config: { ghBin: '/nonexistent' },
    })
  })
})
