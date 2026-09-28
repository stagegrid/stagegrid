import { create } from 'zustand'

const HIGHLIGHT_MS = 2000

interface HighlightState {
  /** cellId → expiry timestamp */
  cells: Record<string, number>
  flash(cellIds: string[]): void
}

/** Cells changed by someone else glow briefly (spec 03 §4 "Real-time feedback"). */
export const useHighlights = create<HighlightState>((set) => ({
  cells: {},
  flash(cellIds) {
    const until = Date.now() + HIGHLIGHT_MS
    set((s) => ({ cells: { ...s.cells, ...Object.fromEntries(cellIds.map((id) => [id, until])) } }))
    setTimeout(() => {
      set((s) => {
        const now = Date.now()
        return { cells: Object.fromEntries(Object.entries(s.cells).filter(([, t]) => t > now)) }
      })
    }, HIGHLIGHT_MS + 50)
  },
}))
