import { useCallback, useState } from 'react'

/** A Set<string> persisted in localStorage under `key`. */
export function useLocalSet(key: string): [ReadonlySet<string>, (id: string) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggle = useCallback(
    (id: string) =>
      setSet((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        localStorage.setItem(key, JSON.stringify([...next]))
        return next
      }),
    [key],
  )
  return [set, toggle]
}

export function useLocalBoolean(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key)
    return raw === null ? initial : raw === 'true'
  })
  const set = useCallback(
    (v: boolean) => {
      localStorage.setItem(key, String(v))
      setValue(v)
    },
    [key],
  )
  return [value, set]
}
