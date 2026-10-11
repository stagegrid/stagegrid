import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { runs, taskEvents } from '../../src/db/schema'
import {
  answerQuestion,
  askQuestions,
  listBatches,
  pinContextAndRelease,
} from '../../src/services/questions.service'
import {
  cancelRun,
  claimRun,
  heartbeatRun,
  listRuns,
  recordRunEvent,
  runnerQueue,
} from '../../src/services/runs.service'
import { getTask, transitionTask } from '../../src/services/tasks.service'
import { getAttention, getThread } from '../../src/services/thread.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, makeCtx, seedProject } from '../helpers/factories'
import { captureEvents } from '../helpers/listen'
import { runningRun, workSetup, type WorkWorld } from '../helpers/work'

const getDb = useTestDatabase()
type Running = Awaited<ReturnType<typeof runningRun>>

const ask = (s: WorkWorld, r: Running, key = 'ask-1', count = 2) =>
  askQuestions(s.system, r.row, r.run.id, {
    questions: Array.from({ length: count }, (_, i) => ({
      prompt: `Question ${i + 1}?`,
      options: i === 0 ? ['Yes', 'No'] : [],
    })),
    contextRevisionId: r.contextRevisionId,
    idempotencyKey: key,
    fencingToken: r.token,
  })

const answer = (s: WorkWorld, id: string, text = 'Yes', key = `a-${id}`, changesScope = false) =>
  answerQuestion(s.ctx, s.project.id, id, { answer: text, idempotencyKey: key, changesScope })

describe('asking questions', () => {
  it('pauses the run and the task, and revokes the claim', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    expect(batch).toMatchObject({ state: 'open', holdForContext: false })
    expect(batch.questions.map((q) => [q.position, q.prompt, q.options])).toEqual([
      [1, 'Question 1?', ['Yes', 'No']],
      [2, 'Question 2?', []],
    ])
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('waiting_for_answer')
    expect(task.run).toMatchObject({ state: 'waiting_for_answer' })
    await expect(heartbeatRun(s.system, r.row, r.run.id, r.token)).rejects.toMatchObject({
      details: { code: 'stale_fencing' },
    })
    expect(await runnerQueue(s.system, r.row)).toEqual([])
  })

  it('returns the same batch for the same key', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const first = await ask(s, r)
    expect((await ask(s, r)).id).toBe(first.id)
  })

  it('refuses questions about a different context', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await expect(
      askQuestions(s.system, r.row, r.run.id, {
        questions: [{ prompt: 'Q?', options: [] }],
        contextRevisionId: '00000000-0000-4000-8000-000000000000',
        idempotencyKey: 'x',
        fencingToken: r.token,
      }),
    ).rejects.toMatchObject({ details: { code: 'context_changed' } })
    expect((await getTask(s.ctx, s.project.id, r.task.id)).state).toBe('in_progress')
  })

  it('refuses a runner that is not holding the run', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await expect(
      askQuestions(s.system, r.row, r.run.id, {
        questions: [{ prompt: 'Q?', options: [] }],
        contextRevisionId: r.contextRevisionId,
        idempotencyKey: 'x',
        fencingToken: r.token + 3,
      }),
    ).rejects.toMatchObject({ details: { code: 'stale_fencing' } })
  })
})

describe('answering (AC-04)', () => {
  it('stores answers one by one and continues once, after the last (AC-04)', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    const [q1, q2] = batch.questions

    const afterFirst = await answer(s, q1!.id, 'Yes')
    expect(afterFirst.state).toBe('open')
    expect((await getTask(s.ctx, s.project.id, r.task.id)).state).toBe('waiting_for_answer')
    expect(await runnerQueue(s.system, r.row)).toEqual([])

    // A repeat of the same answer (a reload and resubmit) changes nothing.
    await answer(s, q1!.id, 'Yes')
    await expect(answer(s, q1!.id, 'Yes', 'another-click')).rejects.toMatchObject({
      details: { code: 'already_answered' },
    })

    const afterLast = await answer(s, q2!.id, 'Reject the second booking')
    expect(afterLast.state).toBe('answered')
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('in_progress')
    expect(task.run).toMatchObject({ state: 'queued' })
    expect(await runnerQueue(s.system, r.row)).toHaveLength(1)

    await answer(s, q2!.id, 'Reject the second booking')
    const continued = await s.db.db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, r.task.id))
    expect(continued.filter((e) => e.action === 'answered')).toHaveLength(1)

    // The continuation carries every answer, and the same session reference.
    const claim = await claimRun(s.system, r.row, r.run.id, { idempotencyKey: 'c2' })
    expect(claim.answers).toEqual([
      { question: 'Question 1?', answer: 'Yes' },
      { question: 'Question 2?', answer: 'Reject the second booking' },
    ])
    expect(claim.run.fencingToken).toBeGreaterThan(r.token)
  })

  it("numbers a continuation's events after the ones already recorded", async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await recordRunEvent(s.system, r.row, r.run.id, {
      eventId: 'e1',
      sequence: 1,
      type: 'progress',
      payload: { message: 'thinking' },
      fencingToken: r.token,
    })
    const batch = await ask(s, r, 'ask-1', 1)
    await answer(s, batch.questions[0]!.id)
    const claim = await claimRun(s.system, r.row, r.run.id, { idempotencyKey: 'c2' })
    expect(claim.run.lastSequence).toBe(1)
    const ev = (n: number) => ({
      eventId: `e${n}`,
      sequence: n,
      type: 'progress' as const,
      payload: { message: `step ${n}` },
      fencingToken: claim.run.fencingToken,
    })
    await expect(recordRunEvent(s.system, r.row, r.run.id, ev(1))).resolves.toMatchObject({
      duplicate: true,
    })
    await expect(
      recordRunEvent(s.system, r.row, r.run.id, { ...ev(1), eventId: 'again' }),
    ).rejects.toMatchObject({
      details: { code: 'out_of_order' },
    })
    await expect(recordRunEvent(s.system, r.row, r.run.id, ev(2))).resolves.toMatchObject({
      duplicate: false,
    })
  })

  it('continues exactly once when the last answers arrive together', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r, 'ask-1', 3)
    const [a, b, c] = batch.questions
    await answer(s, a!.id)
    await Promise.all([answer(s, b!.id), answer(s, c!.id)])
    const events = await s.db.db.select().from(taskEvents).where(eq(taskEvents.taskId, r.task.id))
    expect(events.filter((e) => e.action === 'answered')).toHaveLength(1)
    expect((await listRuns(s.ctx, s.project.id, r.task.id))[0]!.state).toBe('queued')
  })

  it('needs an editor on the project; other projects see nothing (AC-05)', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    const q = batch.questions[0]!
    const viewer = await createUser(s.db, { name: 'Vi' })
    await addMember(s.db, s.project.id, viewer.userId, 'viewer')
    await expect(
      answerQuestion(makeCtx(s.db, viewer, s.clock.now), s.project.id, q.id, {
        answer: 'x',
        idempotencyKey: 'k',
        changesScope: false,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const outsider = await createUser(s.db, { name: 'Out' })
    await expect(
      answerQuestion(makeCtx(s.db, outsider, s.clock.now), s.project.id, q.id, {
        answer: 'x',
        idempotencyKey: 'k',
        changesScope: false,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const other = await seedProject(s.db, s.admin, { name: 'Other' })
    await expect(
      answerQuestion(s.ctx, other.id, q.id, {
        answer: 'x',
        idempotencyKey: 'k',
        changesScope: false,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const [after] = await listBatches(s.ctx, s.project.id, r.task.id)
    expect(after!.questions.every((x) => x.state === 'open')).toBe(true)
  })

  it('publishes a question event and nothing when the answer is refused', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    const events = await captureEvents(() => answer(s, batch.questions[0]!.id))
    expect(events.map((e) => e.type)).toEqual(['question.updated'])
    const quiet = await captureEvents(async () => {
      await expect(answer(s, batch.questions[0]!.id, 'No', 'other')).rejects.toThrow()
    })
    expect(quiet).toEqual([])
  })
})

describe('cancelling (AC-16)', () => {
  it('cancels the questions with the run, so a late answer cannot restart anything', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    await cancelRun(s.ctx, s.project.id, r.run.id, 'Not needed')
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('ready')
    await expect(answer(s, batch.questions[0]!.id)).rejects.toMatchObject({
      details: { code: 'question_cancelled' },
    })
    const [saved] = await s.db.db.select().from(runs).where(eq(runs.id, r.run.id))
    expect(saved!.state).toBe('cancelled')
    expect(await runnerQueue(s.system, r.row)).toEqual([])
    const [after] = await listBatches(s.ctx, s.project.id, r.task.id)
    expect(after).toMatchObject({ state: 'cancelled' })
    expect(after!.questions.every((q) => q.state === 'cancelled')).toBe(true)
  })

  it('cancelling the task stops its run and questions too', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    await transitionTask(s.ctx, s.project.id, r.task.id, {
      action: 'cancel',
      expectedVersion: task.version,
      reason: 'Out of scope',
    })
    expect((await listRuns(s.ctx, s.project.id, r.task.id))[0]!.state).toBe('cancelled')
    await expect(answer(s, batch.questions[0]!.id)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('a scope change', () => {
  it('records the answer but waits for a new pinned context before continuing', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r, 'ask-1', 1)
    const done = await answer(s, batch.questions[0]!.id, 'Also support SSO login', 'k', true)
    expect(done).toMatchObject({ state: 'answered', holdForContext: true })
    let task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('waiting_for_answer')
    expect(await runnerQueue(s.system, r.row)).toEqual([])

    const pinned = await pinContextAndRelease(s.ctx, s.project.id, r.task.id, {
      documentIds: [],
      sources: [],
      decisions: ['Email and password only', 'Also support SSO login'],
    })
    task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('in_progress')
    const claim = await claimRun(s.system, r.row, r.run.id, { idempotencyKey: 'c2' })
    expect(claim.context.revisionId).toBe(pinned.revisionId)
    expect(claim.context.manifest.decisions).toContain('Also support SSO login')
    expect(claim.answers).toHaveLength(1)

    // Pinning again later doesn't continue anything a second time.
    await pinContextAndRelease(s.ctx, s.project.id, r.task.id, {
      documentIds: [],
      sources: [],
      decisions: ['x'],
    })
    const events = await s.db.db.select().from(taskEvents).where(eq(taskEvents.taskId, r.task.id))
    expect(events.filter((e) => e.action === 'answered')).toHaveLength(1)
  })
})

describe('thread and attention', () => {
  it('lists what needs a person: questions first, then runs that stopped', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    expect(await getAttention(s.ctx, s.project.id)).toEqual([])
    const batch = await ask(s, r)
    const [item] = await getAttention(s.ctx, s.project.id)
    expect(item).toMatchObject({
      kind: 'question',
      taskTitle: 'Email login',
      itemPath: 'Login',
      stageName: 'Implement',
      employee: { displayName: 'Mali' },
    })
    expect(item!.summary).toContain('2 questions waiting')
    await answer(s, batch.questions[0]!.id)
    await answer(s, batch.questions[1]!.id)
    expect(await getAttention(s.ctx, s.project.id)).toEqual([])
  })

  it('tells the story of a task in order', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const batch = await ask(s, r)
    s.clock.advance(1000)
    await answer(s, batch.questions[0]!.id, 'Yes')
    const thread = await getThread(s.ctx, s.project.id, r.task.id)
    const kinds = thread.map((t) => t.kind)
    expect(kinds.indexOf('question')).toBeLessThan(kinds.indexOf('answer'))
    expect(thread.find((t) => t.kind === 'question')).toMatchObject({
      actor: { name: 'Mali', isEmployee: true },
      text: 'Question 1?',
      detail: 'Options: Yes · No',
    })
    expect(thread.find((t) => t.kind === 'answer')).toMatchObject({
      actor: { name: 'Pond', isEmployee: false },
      text: 'Yes',
    })
    expect(thread.some((t) => t.text === 'Run started')).toBe(true)
  })
})
