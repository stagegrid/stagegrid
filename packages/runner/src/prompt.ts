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
