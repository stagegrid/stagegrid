import {
  type Ceilings,
  DEFAULT_CEILINGS,
  type ProviderCapacity,
  type UsageWindow,
} from '@stagegrid/shared'

export type WindowName = 'fiveHour' | 'weekly'

export interface CapacityBlock {
  window: WindowName
  percent: number
  ceiling: number
  /** When the window resets, if the provider said. */
  resetsAt: string | null
}

/** Usage of a window now: a window whose reset time has passed starts over at zero. */
export function currentPercent(w: UsageWindow | null, now: Date): number {
  if (!w) return 0
  if (w.resetsAt && new Date(w.resetsAt).getTime() <= now.getTime()) return 0
  return w.percent
}

export function ceilingsFor(
  ceilings: Record<string, Ceilings> | undefined,
  provider: string,
): Ceilings {
  return ceilings?.[provider] ?? { ...DEFAULT_CEILINGS }
}

/**
 * Why this provider account shouldn't take new work, or null when there's room. Usage at or above
 * the ceiling blocks; a ceiling of 100 means "use everything".
 */
export function capacityBlock(
  capacity: ProviderCapacity | undefined,
  ceilings: Ceilings,
  now: Date,
): CapacityBlock | null {
  if (!capacity) return null
  for (const window of ['fiveHour', 'weekly'] as const) {
    const w = capacity[window]
    const percent = currentPercent(w, now)
    if (percent >= ceilings[window])
      return { window, percent, ceiling: ceilings[window], resetsAt: w?.resetsAt ?? null }
  }
  return null
}
