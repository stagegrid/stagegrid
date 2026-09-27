const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** URL slug from a project name; falls back to project-xxxxxx when the name has no Latin letters/digits. */
export function slugify(name: string, random: () => number = Math.random): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  if (base.length >= 2) return base
  let suffix = ''
  for (let i = 0; i < 6; i++) suffix += RANDOM_CHARS[Math.floor(random() * RANDOM_CHARS.length)]
  return `project-${suffix}`
}

/** First of base, base-2, base-3 … not in `taken` (kept within 50 chars). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = base.slice(0, 50 - suffix.length).replace(/-+$/, '') + suffix
    if (!taken.has(candidate)) return candidate
  }
}
