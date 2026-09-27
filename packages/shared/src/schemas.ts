import { z } from 'zod'

import { CELL_STATUSES, LIMITS, LINK_KINDS, PATH_SEPARATOR, PROJECT_ROLES } from './constants'
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
