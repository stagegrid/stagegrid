import { z } from 'zod'

import { CELL_STATUSES, LIMITS, PATH_SEPARATOR, PROJECT_ROLES } from './constants'
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

// ---- changes
export const changeInput = z.object({
  item: refSchema,
  stage: refSchema,
  status: cellStatusSchema.optional(),
  happenedAt: isoDateTimeSchema.optional(),
  reason: z.string().trim().max(LIMITS.reason).optional(),
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
