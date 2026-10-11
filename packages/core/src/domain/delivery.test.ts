import { describe, expect, it } from 'vitest'

import { artifactRef, summarizeChecks, validateSubmission } from './delivery'

const sha = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'
const pr = {
  kind: 'pull_request' as const,
  url: 'https://github.com/acme/clinic/pull/12',
  repo: 'acme/clinic',
  branch: 'stagegrid/task-1',
  headCommit: sha,
}
const commit = { kind: 'commit' as const, url: null, repo: null, branch: null, headCommit: sha }
const check = { command: 'pnpm test', exitCode: 0, commit: sha, source: 'runner_reported' as const }
const local = { mode: 'local' as const, repo: null }
const prMode = { mode: 'pull_request' as const, repo: 'acme/clinic' }

describe('validateSubmission', () => {
  it('accepts a local commit with a check run on it', () => {
    expect(validateSubmission({ artifacts: [commit], verification: [check] }, local)).toEqual([])
  })
  it('accepts a pull request in the allowed repository', () => {
    expect(validateSubmission({ artifacts: [pr], verification: [check] }, prMode)).toEqual([])
  })
  it('rejects a delivery with no evidence (AC-10)', () => {
    expect(validateSubmission({ artifacts: [commit], verification: [] }, local)).toEqual([
      expect.stringContaining('No check was run against the delivered commit'),
    ])
  })
  it('rejects checks run on some other commit', () => {
    const other = { ...check, commit: 'ffffffffffffffffffffffffffffffffffffffff' }
    expect(validateSubmission({ artifacts: [commit], verification: [other] }, local)).toHaveLength(
      1,
    )
  })
  it('rejects an empty delivery', () => {
    expect(validateSubmission({ artifacts: [], verification: [check] }, local)[0]).toMatch(
      /Nothing was delivered/,
    )
  })
  it('rejects artifacts that disagree about the commit', () => {
    const other = { ...commit, headCommit: 'b'.repeat(40) }
    expect(validateSubmission({ artifacts: [pr, other], verification: [check] }, prMode)).toContain(
      'The delivered artifacts point at different commits.',
    )
  })
  it('keeps pull requests inside what the project allows', () => {
    expect(validateSubmission({ artifacts: [pr], verification: [check] }, local)).toContain(
      "This project doesn't allow employees to open pull requests.",
    )
    expect(
      validateSubmission(
        { artifacts: [pr], verification: [check] },
        { mode: 'pull_request', repo: 'acme/other' },
      ),
    ).toContain('The pull request is in acme/clinic, not acme/other.')
    const bad = { ...pr, url: 'https://evil.example.com/acme/clinic/pull/1' }
    expect(validateSubmission({ artifacts: [bad], verification: [check] }, prMode)[0]).toMatch(
      /needs its GitHub URL/,
    )
  })
  it('keeps pushed branches inside what the project allows', () => {
    const branch = {
      kind: 'branch' as const,
      url: null,
      repo: 'acme/clinic',
      branch: 'stagegrid/task-1',
      headCommit: sha,
    }
    expect(validateSubmission({ artifacts: [branch], verification: [check] }, local)).toContain(
      "This project doesn't allow employees to push branches.",
    )
    expect(
      validateSubmission(
        { artifacts: [branch], verification: [check] },
        { mode: 'branch', repo: 'acme/clinic' },
      ),
    ).toEqual([])
  })
  it('matches abbreviated commits', () => {
    const short = { ...check, commit: sha.slice(0, 7) }
    expect(validateSubmission({ artifacts: [commit], verification: [short] }, local)).toEqual([])
  })
})

describe('artifactRef', () => {
  it('identifies the same deliverable across retries', () => {
    expect(artifactRef(pr)).toBe('https://github.com/acme/clinic/pull/12')
    expect(artifactRef({ ...pr, kind: 'branch' })).toBe('acme/clinic#stagegrid/task-1')
    expect(artifactRef(commit)).toBe(sha)
  })
})

describe('summarizeChecks', () => {
  it('counts only checks on the delivered commit and reports the strongest source', () => {
    const checks = [
      check,
      { ...check, exitCode: 1, source: 'ci_checked' as const },
      { ...check, commit: 'f'.repeat(40) },
    ]
    expect(summarizeChecks(checks, sha)).toEqual({
      onCommit: 2,
      passing: 1,
      failing: 1,
      strongest: 'ci_checked',
    })
    expect(summarizeChecks([], sha)).toEqual({
      onCommit: 0,
      passing: 0,
      failing: 0,
      strongest: null,
    })
  })
})
