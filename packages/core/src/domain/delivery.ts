import type { ArtifactKind, DeliverySettings, EvidenceSource } from '@stagegrid/shared'

export interface ArtifactInputLike {
  kind: ArtifactKind
  url: string | null
  repo: string | null
  branch: string | null
  headCommit: string
}

export interface CheckLike {
  command: string
  exitCode: number
  commit: string
  source: EvidenceSource
}

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/i

const sameCommit = (a: string, b: string): boolean => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.startsWith(y) || y.startsWith(x)
}

/** What makes a retried delivery the same artifact rather than a new one. */
export function artifactRef(a: ArtifactInputLike): string {
  if (a.kind === 'pull_request') return a.url ?? ''
  if (a.kind === 'branch') return `${a.repo ?? ''}#${a.branch ?? ''}`
  return a.headCommit.toLowerCase()
}

/**
 * Problems that make a delivery unacceptable as completed work (empty list = fine). A delivery needs
 * something to review, one commit that everything agrees on, checks run against that commit, and
 * must stay within what the project allows to leave the runner's machine.
 */
export function validateSubmission(
  input: { artifacts: ArtifactInputLike[]; verification: CheckLike[] },
  delivery: DeliverySettings,
): string[] {
  const problems: string[] = []
  if (input.artifacts.length === 0)
    problems.push('Nothing was delivered: no commit, branch or pull request.')
  const head = input.artifacts[0]?.headCommit
  for (const a of input.artifacts) {
    if (head && !sameCommit(a.headCommit, head))
      problems.push('The delivered artifacts point at different commits.')
    if (a.kind === 'pull_request') {
      const m = a.url ? PR_URL.exec(a.url) : null
      if (!m)
        problems.push('A pull request needs its GitHub URL (https://github.com/owner/repo/pull/N).')
      else if (delivery.repo && `${m[1]}/${m[2]}`.toLowerCase() !== delivery.repo.toLowerCase())
        problems.push(`The pull request is in ${m[1]}/${m[2]}, not ${delivery.repo}.`)
      if (delivery.mode !== 'pull_request')
        problems.push("This project doesn't allow employees to open pull requests.")
    }
    if (a.kind === 'document') problems.push('Documents are delivered by an Analyst, not as code.')
    if (a.kind === 'branch') {
      if (!a.branch) problems.push('A pushed branch needs its name.')
      if (delivery.mode === 'local')
        problems.push("This project doesn't allow employees to push branches.")
      else if (delivery.repo && a.repo && a.repo.toLowerCase() !== delivery.repo.toLowerCase())
        problems.push(`The branch is in ${a.repo}, not ${delivery.repo}.`)
    }
  }
  if (head) {
    const onCommit = input.verification.filter((v) => sameCommit(v.commit, head))
    if (onCommit.length === 0)
      problems.push(
        'No check was run against the delivered commit, so there is no evidence it works.',
      )
  } else if (input.verification.length === 0) problems.push('No checks were reported.')
  return [...new Set(problems)]
}

const STRENGTH: EvidenceSource[] = ['agent_reported', 'runner_reported', 'ci_checked']

/** How well the delivered commit is backed up, for the person deciding. */
export function summarizeChecks(
  checks: CheckLike[],
  headCommit: string,
): { onCommit: number; passing: number; failing: number; strongest: EvidenceSource | null } {
  const onCommit = checks.filter((c) => sameCommit(c.commit, headCommit))
  let strongest: EvidenceSource | null = null
  for (const c of onCommit)
    if (strongest === null || STRENGTH.indexOf(c.source) > STRENGTH.indexOf(strongest))
      strongest = c.source
  return {
    onCommit: onCommit.length,
    passing: onCommit.filter((c) => c.exitCode === 0).length,
    failing: onCommit.filter((c) => c.exitCode !== 0).length,
    strongest,
  }
}

export { sameCommit }
