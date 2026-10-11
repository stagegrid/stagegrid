import { z } from 'zod'

import {
  ARTIFACT_KINDS,
  CELL_PROGRESS_MODES,
  CELL_STATUSES,
  DELIVERY_MODES,
  EMPLOYEE_PROVIDERS,
  EMPLOYEE_ROLES,
  EVIDENCE_SOURCES,
  LIMITS,
  LINK_KINDS,
  PATH_SEPARATOR,
  PROJECT_ROLES,
  RUN_EVENT_TYPES,
  RUN_OUTCOMES,
  TASK_ACTIONS,
  TASK_STATES,
} from './constants'
import { isValidTimeZone } from './time'

export const nameSchema = (max: number) => z.string().trim().min(1).max(max)

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
export const passwordSchema = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax)
export const timezoneSchema = z.string().refine(isValidTimeZone, 'Unknown time zone')
export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens')
export const itemNameSchema = nameSchema(LIMITS.itemName).refine(
  (s) => !s.includes(PATH_SEPARATOR),
  `Item names can't contain "${PATH_SEPARATOR}"`,
)
export const cellStatusSchema = z.enum(CELL_STATUSES)
export const projectRoleSchema = z.enum(PROJECT_ROLES)
export const isoDateTimeSchema = z.iso.datetime({ offset: true })
export const refSchema = z.string().trim().min(1).max(2000)

// ---- setup & auth
export const setupInput = z.object({
  name: nameSchema(LIMITS.userName),
  email: emailSchema,
  password: passwordSchema,
  instanceName: nameSchema(100).default('Stagegrid'),
  timezone: timezoneSchema,
})
export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
})
export const acceptInput = z.object({
  token: z.string().min(1).max(200),
  name: nameSchema(LIMITS.userName).optional(),
  password: passwordSchema,
})

// ---- users
export const createUserInput = z.object({
  name: nameSchema(LIMITS.userName),
  email: emailSchema,
  isAdmin: z.boolean().default(false),
})
export const updateUserInput = z.object({
  name: nameSchema(LIMITS.userName).optional(),
  isAdmin: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})
export const updateMeInput = z.object({ name: nameSchema(LIMITS.userName) })
export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
})

// ---- api tokens
export const createTokenInput = z.object({
  name: nameSchema(60),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
})
export type CreateTokenInput = z.infer<typeof createTokenInput>

// ---- projects
export const createProjectInput = z.object({
  name: nameSchema(LIMITS.projectName),
  description: z.string().trim().max(LIMITS.projectDescription).default(''),
  slug: slugSchema.optional(),
  timezone: timezoneSchema.optional(),
  copyStagesFrom: refSchema.optional(),
})
export const deliverySettingsInput = z.object({
  mode: z.enum(DELIVERY_MODES),
  repo: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/name')
    .nullable(),
})

export const updateProjectInput = z.object({
  name: nameSchema(LIMITS.projectName).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(LIMITS.projectDescription).optional(),
  timezone: timezoneSchema.optional(),
  staleDays: z.number().int().min(LIMITS.staleDaysMin).max(LIMITS.staleDaysMax).optional(),
  defaultReleasePhases: z
    .array(z.object({ name: nameSchema(60), freeze: z.boolean().optional() }))
    .max(10)
    .refine(
      (ps) => ps.filter((p) => p.freeze).length <= 1,
      'At most one phase can be the freeze point',
    )
    .optional(),
  delivery: deliverySettingsInput.optional(),
})
export const addMemberInput = z.object({ userId: z.uuid(), role: projectRoleSchema })
export const updateMemberInput = z.object({ role: projectRoleSchema })

// ---- stages
export const createStageInput = z.object({
  name: nameSchema(LIMITS.stageName),
  afterId: z.uuid().optional(),
})
export const renameStageInput = z.object({ name: nameSchema(LIMITS.stageName) })
export const moveStageInput = z.object({
  beforeId: z.uuid().optional(),
  afterId: z.uuid().optional(),
})

// ---- items
export interface ItemTreeInput {
  name: string
  children?: ItemTreeInput[]
}
export const itemTreeSchema: z.ZodType<ItemTreeInput> = z.object({
  name: itemNameSchema,
  get children() {
    return z.array(itemTreeSchema).optional()
  },
})
export const createItemsInput = z.object({
  parent: refSchema.nullable().optional(),
  before: refSchema.optional(),
  after: refSchema.optional(),
  items: z.array(itemTreeSchema).min(1),
})
export const renameItemInput = z.object({ name: itemNameSchema })
export const moveItemInput = z.object({
  parent: refSchema.nullable().optional(),
  before: refSchema.optional(),
  after: refSchema.optional(),
})

// ---- cell details
export const dateSchema = z.iso.date()
export const assigneeInput = z.union([
  z.object({ userId: z.uuid() }),
  z.object({ name: nameSchema(LIMITS.assigneeName) }),
])
export const urlSchema = z
  .string()
  .trim()
  .max(LIMITS.linkUrl)
  .pipe(z.url({ protocol: /^https?$/ }))
export const linkInput = z.object({
  title: nameSchema(LIMITS.linkTitle),
  url: urlSchema,
  kind: z.enum(LINK_KINDS).default('other'),
})
export const commentBodySchema = z.string().trim().min(1).max(LIMITS.commentBody)
export const commentInput = z.object({ body: commentBodySchema })
export const editEventInput = z.object({ happenedAt: isoDateTimeSchema })

// ---- changes
export const changeInput = z.object({
  item: refSchema,
  stage: refSchema,
  status: cellStatusSchema.optional(),
  happenedAt: isoDateTimeSchema.optional(),
  reason: z.string().trim().max(LIMITS.reason).optional(),
  assignees: z
    .array(assigneeInput)
    .max(LIMITS.assigneesPerCell)
    .optional()
    .describe('Replaces all assignees of the cell'),
  plannedStart: dateSchema.nullable().optional(),
  plannedEnd: dateSchema.nullable().optional(),
  comment: commentBodySchema.optional(),
  link: linkInput.optional(),
})
export const changesInput = z.object({
  changes: z.array(changeInput).min(1).max(LIMITS.changesPerRequest),
  dryRun: z.boolean().default(false),
})

export type SetupInput = z.infer<typeof setupInput>
export type LoginInput = z.infer<typeof loginInput>
export type AcceptInput = z.infer<typeof acceptInput>
export type CreateUserInput = z.infer<typeof createUserInput>
export type UpdateUserInput = z.infer<typeof updateUserInput>
export type CreateProjectInput = z.infer<typeof createProjectInput>
export type UpdateProjectInput = z.infer<typeof updateProjectInput>
export type CreateItemsInput = z.infer<typeof createItemsInput>
export type MoveItemInput = z.infer<typeof moveItemInput>
export type ChangeInput = z.infer<typeof changeInput>
export type ChangesInput = z.infer<typeof changesInput>
export type AssigneeInput = z.infer<typeof assigneeInput>
export type LinkInput = z.infer<typeof linkInput>

// ---- releases
export const releasePhaseInput = z.object({
  id: z.uuid().optional(),
  name: nameSchema(60),
  plannedStart: dateSchema.nullable().optional(),
  plannedEnd: dateSchema.nullable().optional(),
  freeze: z.boolean().optional(),
})
export const releasePhasesInput = z
  .array(releasePhaseInput)
  .max(10)
  .refine(
    (ps) => ps.filter((p) => p.freeze).length <= 1,
    'At most one phase can be the freeze point',
  )
export const createReleaseInput = z.object({
  name: nameSchema(100),
  targetDate: dateSchema,
  description: z.string().trim().max(2000).default(''),
  phases: releasePhasesInput.optional(),
})
export const updateReleaseInput = z.object({
  name: nameSchema(100).optional(),
  targetDate: dateSchema.optional(),
  description: z.string().trim().max(2000).optional(),
})
export const releaseItemInput = z
  .object({
    item: refSchema,
    kind: z.enum(['new', 'change']),
    stages: z
      .array(refSchema)
      .min(1)
      .max(30)
      .optional()
      .describe('Required for kind "change": the stages to redo'),
    includeDescendants: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.kind === 'new' || (v.stages?.length ?? 0) > 0, {
    message: 'kind "change" needs stages',
    path: ['stages'],
  })
  .refine((v) => v.kind === 'change' || !v.stages, {
    message: 'kind "new" takes every stage; omit stages',
    path: ['stages'],
  })
export const addReleaseItemsInput = z.object({
  items: z.array(releaseItemInput).min(1).max(500),
  dryRun: z.boolean().default(false),
})
export const releaseNoteInput = z.object({ note: z.string().trim().max(500).nullable() })
export const markReleasedInput = z.object({ force: z.boolean().default(false) })

export type ReleasePhaseInput = z.infer<typeof releasePhaseInput>
export type CreateReleaseInput = z.infer<typeof createReleaseInput>
export type UpdateReleaseInput = z.infer<typeof updateReleaseInput>
export type ReleaseItemInput = z.infer<typeof releaseItemInput>
export type AddReleaseItemsInput = z.infer<typeof addReleaseItemsInput>

// ---- documents
export const docDraftInput = z.object({
  sections: z.record(z.string(), z.string().max(50_000)).optional(),
  fields: z
    .record(
      z.string(),
      z.union([
        z.string().max(50_000),
        z.array(z.string().max(2000)).max(200),
        z.array(z.record(z.string(), z.string().max(2000))).max(200),
      ]),
    )
    .optional(),
})
export const saveDocDraftInput = z.object({
  template: refSchema.describe('Template key (e.g. "srs") or id'),
  draft: docDraftInput,
  title: nameSchema(200).optional(),
  item: refSchema.optional(),
  stage: refSchema.optional(),
  release: refSchema.optional(),
  documentId: z.uuid().optional().describe('Give it to save a new version of an existing document'),
})
export const projectDocTemplatesInput = z.object({ templateIds: z.array(z.uuid()).max(100) })
export type SaveDocDraftInput = z.infer<typeof saveDocDraftInput>

// ---- tasks
const criteriaSchema = z
  .array(z.string().trim().min(1).max(LIMITS.acceptanceCriterion))
  .max(LIMITS.acceptanceCriteria)

export const createTaskInput = z.object({
  cellId: z.uuid(),
  title: nameSchema(LIMITS.taskTitle),
  scope: z.string().trim().max(LIMITS.taskScope).default(''),
  acceptanceCriteria: criteriaSchema.default([]),
  required: z.boolean().default(true),
  ownerUserId: z.uuid().nullable().default(null),
  employeeId: z.uuid().nullable().default(null),
})
export const updateTaskInput = z.object({
  expectedVersion: z.number().int().min(1),
  title: nameSchema(LIMITS.taskTitle).optional(),
  scope: z.string().trim().max(LIMITS.taskScope).optional(),
  acceptanceCriteria: criteriaSchema.optional(),
  required: z.boolean().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  employeeId: z.uuid().nullable().optional(),
})
export const taskActionInput = z.object({
  action: z.enum(TASK_ACTIONS),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(LIMITS.reason).optional(),
})
export const listTasksQuery = z.object({
  state: z.enum(TASK_STATES).optional(),
  cellId: z.uuid().optional(),
})
export const setCellProgressModeInput = z.object({ mode: z.enum(CELL_PROGRESS_MODES) })

export type CreateTaskInput = z.infer<typeof createTaskInput>
export type UpdateTaskInput = z.infer<typeof updateTaskInput>
export type TaskActionInput = z.infer<typeof taskActionInput>
export type ListTasksQuery = z.infer<typeof listTasksQuery>

// ---- employees and task context
export const createEmployeeInput = z.object({
  displayName: nameSchema(LIMITS.employeeName),
  role: z.enum(EMPLOYEE_ROLES),
  provider: z.enum(EMPLOYEE_PROVIDERS),
  model: z.string().trim().min(1).max(LIMITS.modelName).nullable().default(null),
  instructions: z.string().trim().max(LIMITS.employeeInstructions).default(''),
  avatar: z.string().trim().min(1).max(LIMITS.employeeAvatar).nullable().default(null),
})
export const updateEmployeeInput = z.object({
  expectedVersion: z.number().int().min(1),
  displayName: nameSchema(LIMITS.employeeName).optional(),
  role: z.enum(EMPLOYEE_ROLES).optional(),
  provider: z.enum(EMPLOYEE_PROVIDERS).optional(),
  model: z.string().trim().min(1).max(LIMITS.modelName).nullable().optional(),
  instructions: z.string().trim().max(LIMITS.employeeInstructions).optional(),
  avatar: z.string().trim().min(1).max(LIMITS.employeeAvatar).nullable().optional(),
})
export const contextSourceInput = z.object({
  title: nameSchema(200),
  url: z.url().max(LIMITS.linkUrl).nullable().default(null),
  content: z.string().trim().min(1).max(LIMITS.contextSourceContent),
})
export const createContextInput = z.object({
  documentIds: z.array(z.uuid()).max(LIMITS.contextDocuments).default([]),
  sources: z.array(contextSourceInput).max(LIMITS.contextSources).default([]),
  decisions: z
    .array(z.string().trim().min(1).max(LIMITS.contextDecision))
    .max(LIMITS.contextDecisions)
    .default([]),
})

export type CreateEmployeeInput = z.infer<typeof createEmployeeInput>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeInput>
export type CreateContextInput = z.infer<typeof createContextInput>

// ---- runs and runners
const idempotencyKey = z.string().trim().min(1).max(LIMITS.idempotencyKey)

const percentSchema = z.number().min(0).max(100)
const usageWindowSchema = z
  .object({ percent: percentSchema, resetsAt: z.iso.datetime({ offset: true }).nullable() })
  .nullable()
export const ceilingsSchema = z.object({
  fiveHour: z.number().int().min(1).max(100),
  weekly: z.number().int().min(1).max(100),
})
export const startRunInput = z.object({
  expectedVersion: z.number().int().min(1),
  contextRevisionId: z.uuid(),
  idempotencyKey,
})
export const cancelRunInput = z.object({ reason: z.string().trim().max(LIMITS.reason).optional() })

export const createEnrollmentInput = z.object({
  name: nameSchema(LIMITS.runnerName),
  projectIds: z.array(z.uuid()).min(1).max(LIMITS.runnerProjects),
})
export const enrollRunnerInput = z.object({
  token: z.string().min(1).max(200),
  providers: z.array(z.string().min(1).max(50)).max(10).default([]),
  version: z.string().max(50).optional(),
})
export const updateRunnerInput = z.object({
  name: nameSchema(LIMITS.runnerName).optional(),
  projectIds: z.array(z.uuid()).min(1).max(LIMITS.runnerProjects).optional(),
  maxConcurrent: z.number().int().min(1).max(20).optional(),
  ceilings: z.record(z.string(), ceilingsSchema).optional(),
})
export const reportCapacityInput = z.object({
  provider: z.string().min(1).max(50),
  fiveHour: usageWindowSchema,
  weekly: usageWindowSchema,
})
export const runnerSelfInput = z.object({
  providers: z.array(z.string().min(1).max(50)).max(10),
  version: z.string().max(50).optional(),
})
export const claimRunInput = z.object({ idempotencyKey })
export const fencedInput = z.object({ fencingToken: z.number().int().min(1) })
export const runEventInput = z.object({
  eventId: z.string().trim().min(1).max(200),
  sequence: z.number().int().min(1),
  type: z.enum(RUN_EVENT_TYPES),
  payload: z
    .record(z.string(), z.unknown())
    .default({})
    .refine((p) => JSON.stringify(p).length <= LIMITS.runEventPayload, 'Payload is too large'),
  fencingToken: z.number().int().min(1),
})
const commitSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,64}$/i, 'Use a commit hash')
export const artifactInput = z.object({
  kind: z.enum(ARTIFACT_KINDS),
  url: z.url().max(LIMITS.linkUrl).nullable().default(null),
  repo: z.string().trim().max(200).nullable().default(null),
  branch: z.string().trim().max(200).nullable().default(null),
  headCommit: commitSchema,
})
export const verificationInput = z.object({
  command: z.string().trim().min(1).max(LIMITS.verificationCommand),
  exitCode: z.number().int(),
  commit: commitSchema,
  source: z.enum(EVIDENCE_SOURCES),
  output: z.string().max(LIMITS.verificationOutput).nullable().default(null),
})
export const submissionInput = z.object({
  artifacts: z.array(artifactInput).min(1).max(LIMITS.artifactsPerSubmission),
  verification: z.array(verificationInput).max(LIMITS.verificationsPerSubmission).default([]),
})
export const acceptTaskInput = z.object({
  expectedVersion: z.number().int().min(1),
  submissionId: z.uuid(),
  headCommit: commitSchema,
  contextRevisionId: z.uuid(),
  idempotencyKey: idempotencyKey,
  /** Accept even though a check on this commit failed. */
  acknowledgeFailing: z.boolean().default(false),
})

export const completeRunInput = z.object({
  fencingToken: z.number().int().min(1),
  idempotencyKey,
  outcome: z.enum(RUN_OUTCOMES),
  summary: z.string().trim().max(LIMITS.runSummary).optional(),
  failureReason: z.string().trim().max(LIMITS.runFailure).optional(),
  /** What was delivered, required when the run succeeded. */
  submission: submissionInput.optional(),
})

export type StartRunInput = z.infer<typeof startRunInput>
export type CancelRunInput = z.infer<typeof cancelRunInput>
export type CreateEnrollmentInput = z.infer<typeof createEnrollmentInput>
export type EnrollRunnerInput = z.infer<typeof enrollRunnerInput>
export type UpdateRunnerInput = z.infer<typeof updateRunnerInput>
export type ReportCapacityInput = z.infer<typeof reportCapacityInput>
export type RunnerSelfInput = z.infer<typeof runnerSelfInput>
export type ClaimRunInput = z.infer<typeof claimRunInput>
export type RunEventInput = z.infer<typeof runEventInput>
export type CompleteRunInput = z.infer<typeof completeRunInput>

// ---- questions
export const askQuestionsInput = z.object({
  questions: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(LIMITS.questionPrompt),
        options: z
          .array(z.string().trim().min(1).max(LIMITS.questionOption))
          .max(LIMITS.questionOptions)
          .default([]),
      }),
    )
    .min(1)
    .max(LIMITS.questionsPerBatch),
  contextRevisionId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(LIMITS.idempotencyKey),
  fencingToken: z.number().int().min(1),
})
export const answerQuestionInput = z.object({
  answer: z.string().trim().min(1).max(LIMITS.answer),
  /** The answer changes what was agreed: the work waits for a new pinned context. */
  changesScope: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(1).max(LIMITS.idempotencyKey),
})

export type AskQuestionsInput = z.infer<typeof askQuestionsInput>
export type AnswerQuestionInput = z.infer<typeof answerQuestionInput>

export type SubmissionInput = z.infer<typeof submissionInput>
export type AcceptTaskInput = z.infer<typeof acceptTaskInput>

// ---- team and approvals
const employeeIdOrNull = z.uuid().nullable()
export const teamSettingsInput = z.object({
  analyst: z.object({
    enabled: z.boolean(),
    employeeId: employeeIdOrNull,
    stageId: employeeIdOrNull,
  }),
  dev: z.object({ employeeId: employeeIdOrNull, stageId: employeeIdOrNull }),
  reviewer: z.object({ enabled: z.boolean(), employeeId: employeeIdOrNull }),
  qa: z.object({ enabled: z.boolean(), employeeId: employeeIdOrNull, stageId: employeeIdOrNull }),
  reworkLimit: z.number().int().min(0).max(LIMITS.reworkLimitMax),
})
export const approveDocumentInput = z.object({
  version: z.number().int().min(1),
  note: z.string().trim().max(LIMITS.approvalNote).optional(),
})
export type TeamSettingsInput = z.infer<typeof teamSettingsInput>
export type ApproveDocumentInput = z.infer<typeof approveDocumentInput>
