import { z } from 'zod'

export const sectionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\w.-]+$/, 'Use letters, digits, dots, hyphens'),
  title: z.string().trim().min(1).max(200),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  hint: z.string().trim().max(1000).default(''),
  repeat: z
    .union([
      z.object({ source: z.literal('items'), depth: z.union([z.literal(1), z.literal(2)]) }),
      z.object({ source: z.literal('release_items'), kind: z.enum(['new', 'change']).optional() }),
    ])
    .optional(),
})

export const fieldSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^\w+$/),
  label: z.string().trim().min(1).max(100),
  hint: z.string().trim().max(1000).default(''),
  type: z.enum(['text', 'longtext', 'date', 'list', 'table']),
  columns: z
    .array(z.object({ id: z.string().regex(/^\w+$/), label: z.string().min(1).max(60) }))
    .min(1)
    .max(10)
    .optional(),
})

export const templateSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('narrative'), sections: z.array(sectionSchema).min(1).max(200) }),
    z.object({
      kind: z.literal('form'),
      fields: z.array(fieldSchema).min(1).max(100),
      sections: z.array(sectionSchema).max(100).optional(),
    }),
  ])
  .superRefine((t, ctx) => {
    const ids = [
      ...(t.sections ?? []).map((s) => s.id),
      ...(t.kind === 'form' ? t.fields.map((f) => f.id) : []),
    ]
    const dup = ids.find((id, i) => ids.indexOf(id) !== i)
    if (dup) ctx.addIssue({ code: 'custom', message: `Duplicate id "${dup}"` })
    if (t.kind === 'form') {
      for (const f of t.fields)
        if (f.type === 'table' && !f.columns)
          ctx.addIssue({ code: 'custom', message: `Table field "${f.id}" needs columns` })
    }
  })

export type TemplateSection = z.infer<typeof sectionSchema>
export type TemplateField = z.infer<typeof fieldSchema>
export type TemplateSchema = z.infer<typeof templateSchema>

export const MAX_SECTION_CHARS = 50_000

export const draftSchema = z.object({
  sections: z.record(z.string(), z.string().max(MAX_SECTION_CHARS)).optional(),
  fields: z
    .record(
      z.string(),
      z.union([
        z.string().max(MAX_SECTION_CHARS),
        z.array(z.string().max(2000)).max(200),
        z.array(z.record(z.string(), z.string().max(2000))).max(200),
      ]),
    )
    .optional(),
})
export type Draft = z.infer<typeof draftSchema>
