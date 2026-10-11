import type { ClaimedRunDto } from '@stagegrid/shared'

const DEV_RULES = `You are {name}, a Dev employee working through Stagegrid. Work only inside the current directory, which is your own git worktree for this task.
Implement exactly the task below against its acceptance criteria and the pinned context. Treat the context as the agreed baseline; do not widen the scope.
If a business rule or acceptance criterion the task depends on is undecided or ambiguous, do not guess and do not write code yet: return status "needs_answers" with every question you need answered, all at once, each with suggested options where sensible. People answer them and you continue.
Use status "blocked" only when you cannot proceed for a reason a question would not fix (say why in the summary).
Otherwise: implement, add a test for every acceptance criterion, run the project's tests, and commit on the current branch with a message starting "feat:" (or "fix:").
Never push, never switch branches, never rewrite history, and never touch files outside this directory.
Your final message must be ONLY the requested JSON: status, a short honest summary (say plainly if any test fails or was not run), the questions (an empty list unless needs_answers), the commit hash (or null) and the test result line (or null).`

export function systemPrompt(name: string, instructions: string): string {
  const base = DEV_RULES.replace('{name}', name)
  return instructions.trim()
    ? `${base}\n\nHow ${name} works on this team:\n${instructions.trim()}`
    : base
}

/** Everything the agent needs to start, in one message. Pinned content only; nothing is fetched later. */
export function taskPrompt(claim: ClaimedRunDto, branch: string): string {
  const parts: string[] = [
    `# Task: ${claim.task.title}`,
    `Project: ${claim.project.name}. Branch: ${branch}.`,
  ]
  if (claim.task.scope.trim()) parts.push(`## Scope\n${claim.task.scope.trim()}`)
  if (claim.task.acceptanceCriteria.length)
    parts.push(
      `## Acceptance criteria\n${claim.task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
    )
  const { manifest } = claim.context
  if (manifest.decisions.length)
    parts.push(`## Confirmed decisions\n${manifest.decisions.map((d) => `- ${d}`).join('\n')}`)
  for (const d of claim.documents)
    parts.push(`## Document: ${d.title} (version ${d.version})\n${d.markdown.trim()}`)
  for (const s of manifest.sources)
    parts.push(
      `## Source: ${s.title}${s.url ? ` (${s.url})` : ''}\nRetrieved ${s.retrievedAt}.\n${s.content.trim()}`,
    )
  if (claim.feedback.length)
    parts.push(
      `## Feedback to address\n${claim.feedback
        .map(
          (f) =>
            `From ${f.source === 'qa' ? 'QA' : f.source}: ${f.summary}\n${f.findings.map((x) => `- [${x.severity}] ${x.text}${x.file ? ` (${x.file})` : ''}`).join('\n')}`,
        )
        .join('\n\n')}\nAddress every point, add or update tests, and commit on this same branch.`,
    )
  if (claim.answers.length)
    parts.push(
      `## Answers to your questions\n${claim.answers.map((a) => `- ${a.question}\n  Answer: ${a.answer}`).join('\n')}`,
    )
  if (claim.run.sessionRef)
    parts.push(
      `You are continuing an earlier session.${claim.answers.length ? ' Your questions have been answered above; implement accordingly.' : ''} Check \`git status\` and \`git log\` first and carry on from there; do not redo work that is already committed.`,
    )
  return parts.join('\n\n')
}

const REVIEWER_RULES = `You are {name}, a Reviewer working through Stagegrid. You review one delivery: the commit checked out in the current directory, a fresh read-only checkout. You never change code and never approve anything: people decide.
Judge the work against the task, its acceptance criteria and the pinned context. Look for correctness bugs, missing or weak tests for each criterion, security problems and scope creep; ignore style nits unless they hide a bug.
Return verdict "pass" only if you would be comfortable with a person accepting it as is; otherwise "changes_requested". List concrete findings, each with a severity (blocker, major, minor, note), what is wrong and where (file) when you know. Do not invent problems; an honest pass with no findings is fine.
Your final message must be ONLY the requested JSON.`

const QA_RULES = `You are {name}, a QA employee working through Stagegrid. You test one accepted commit, checked out in the current directory as a fresh throwaway checkout. You never fix code.
Run the project's tests and probe the behaviour against each acceptance criterion yourself, including edge cases and boundaries. For every criterion report pass, fail or not_tested with the evidence (what you ran and saw).
Return verdict "pass" only if every criterion passes; otherwise "fail", with findings that let a developer reproduce each problem.
Your final message must be ONLY the requested JSON.`

const ANALYST_RULES = `You are {name}, an Analyst working through Stagegrid. You draft the requirement document for one item from the pinned context and what you can read in the repository. You never change code.
Use the document template given below (SRS unless told otherwise) and fill its sections by id with clear, testable requirements written for the people who will build and test them. Keep what is not decided as open questions: if something important is undecided, return status "needs_answers" with every question at once instead of guessing.
Do not claim anything is approved: a person approves the exact version you submit.
Your final message must be ONLY the requested JSON: status, summary, questions (empty unless needs_answers), documents (template key, title, sections with id and content).`

export function systemPromptFor(
  role: 'analyst' | 'dev' | 'reviewer' | 'qa',
  name: string,
  instructions: string,
): string {
  if (role === 'dev') return systemPrompt(name, instructions)
  const base = { reviewer: REVIEWER_RULES, qa: QA_RULES, analyst: ANALYST_RULES }[role].replace(
    '{name}',
    name,
  )
  return instructions.trim()
    ? `${base}\n\nHow ${name} works on this team:\n${instructions.trim()}`
    : base
}

/** The message for a Reviewer, QA or Analyst run: what to examine, and nothing it could mistake for a job to build. */
export function rolePrompt(claim: ClaimedRunDto, branch: string): string {
  const parts: string[] = [taskPrompt(claim, branch)]
  const ex = claim.examine
  if (ex) {
    parts.push(
      `## The delivery you examine\nCommit ${ex.headCommit}.\n${ex.summary}${ex.artifacts.some((a) => a.url) ? `\nPull request: ${ex.artifacts.find((a) => a.url)!.url}` : ''}`,
    )
    if (ex.checks.length)
      parts.push(
        `## Checks reported for it\n${ex.checks.map((c) => `- ${c.command}: exit ${c.exitCode} (${c.source.replace('_', ' ')})`).join('\n')}`,
      )
  }
  if (claim.analyst)
    parts.push(
      `## Templates you can fill in for ${claim.analyst.itemPath}\n${claim.analyst.templates
        .map(
          (t) =>
            `### ${t.name} (key: ${t.key})\n${t.sections.map((s) => `- ${s.id}: ${s.number} ${s.title}`).join('\n')}`,
        )
        .join('\n\n')}`,
    )
  return parts.join('\n\n')
}
