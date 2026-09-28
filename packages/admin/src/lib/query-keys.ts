export const qk = {
  me: ['me'] as const,
  setupStatus: ['setup-status'] as const,
  projects: (archived: boolean) => ['projects', { archived }] as const,
  board: (slug: string) => ['board', slug] as const,
  cell: (slug: string, cellId: string) => ['cell', slug, cellId] as const,
  project: (slug: string) => ['project', slug] as const,
  stages: (slug: string) => ['stages', slug] as const,
  members: (slug: string) => ['members', slug] as const,
  directory: ['directory'] as const,
  users: ['admin-users'] as const,
}
