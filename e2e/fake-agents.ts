/** Stand-ins for the provider CLIs: they behave like Claude Code and Codex would for each role, deterministically. */

const COMMON = `
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n')
const args = process.argv.slice(2)
const bump = (name) => {
  const f = (process.env.FAKE_STATE_DIR || '/tmp') + '/' + name
  const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1
  fs.writeFileSync(f, String(n))
  return n
}
`

/** Claude Code: analyst drafts a document, QA fails the first time, Dev commits (and asks when the task says so). */
export const fakeClaude = (node: string): string => `#!${node}
${COMMON}
const sys = args[args.indexOf('--append-system-prompt') + 1] || ''
const prompt = args[args.length - 1]
const result = (so) => out({ type: 'result', subtype: 'success', is_error: false, structured_output: so })
if (sys.includes('an Analyst')) {
  result({ status: 'submitted', summary: 'Drafted the requirements', questions: [], documents: [
    { template: 'brd', title: 'Requirements: Bookings', sections: [{ id: '1', content: 'People can book, change and cancel appointments online.' }] },
  ] })
} else if (sys.includes('a QA employee')) {
  const n = bump('qa')
  result({
    verdict: n === 1 ? 'fail' : 'pass',
    summary: n === 1 ? 'Cancelling a booking fails' : 'Every criterion passes',
    findings: n === 1 ? [{ severity: 'blocker', text: 'Cancelling a booking returns an error', file: null }] : [],
    results: [{ criterion: 'Bookings can be cancelled', result: n === 1 ? 'fail' : 'pass', evidence: 'Cancelled a booking from the list' }],
  })
} else {
  if (prompt.includes('Slot booking') && !args.includes('--resume')) {
    result({ status: 'needs_answers', summary: 'Two rules are unclear', commit: null, tests: null, questions: [
      { prompt: 'Reject the second booking?', options: ['Yes', 'No'] },
      { prompt: 'Slot length in minutes?', options: [] },
    ] })
    process.exit(0)
  }
  const n = bump('dev')
  fs.writeFileSync('login.txt', 'work ' + n + '\\n')
  execSync('git add -A && git commit -q -m "feat: work ' + n + '"')
  const commit = execSync('git rev-parse HEAD').toString().trim()
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Implemented the work' }] } })
  result({ status: 'submitted', summary: 'Work done', commit, tests: '3 passed', questions: [] })
}
`

/** Codex: the reviewer asks for changes on the first review and passes afterwards. */
export const fakeCodex = (node: string): string => `#!${node}
${COMMON}
process.stdin.resume()
process.stdin.on('data', () => {})
const n = bump('review')
const so = n === 1
  ? { verdict: 'changes_requested', summary: 'Cancelling a booking is missing', findings: [{ severity: 'major', text: 'Cancellation is not implemented', file: 'src/bookings.ts' }] }
  : { verdict: 'pass', summary: 'Looks good', findings: [] }
out({ type: 'thread.started', thread_id: 'th-e2e' })
out({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(so) } })
out({ type: 'turn.completed' })
`
