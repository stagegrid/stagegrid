const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/** "3 days ago", "in 2 hours", "now". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit)
  }
  return 'now'
}

/** Absolute date-time in the project's time zone, e.g. "Oct 12, 2026, 14:05". */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}

export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone }).format(new Date(iso))
}

/** Letters and digits usable as an initial; skips punctuation and Thai leading vowels (เ แ โ ใ ไ). */
const initialChars = (word: string) =>
  [...word].filter((c) => /[\p{L}\p{N}]/u.test(c) && !/[เ-ไ]/.test(c))

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map(initialChars)
    .filter((w) => w.length > 0)
  if (words.length === 0) return '?'
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2).join('')
  return letters.toUpperCase()
}

/** Value for <input type="datetime-local"> from an instant, in the browser's zone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
