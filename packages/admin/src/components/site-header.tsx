import { MoonIcon, SunIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useTheme } from '@/lib/theme'

/** Top bar. `actions` is a slot for page-level buttons such as Connect AI (phase 2). */
export function SiteHeader({ actions }: { actions?: ReactNode }) {
  const { theme, toggleTheme } = useTheme()
  return (
    <header className="bg-background sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" />
      <div className="text-foreground flex shrink-0 items-center gap-2 text-sm font-semibold">
        <img src="/favicon.svg" alt="" className="size-6" />
        Stagegrid
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
    </header>
  )
}
