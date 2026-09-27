import type { CSSProperties, ReactNode } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConnectAiDialog } from '@/features/connect/ConnectAiDialog'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider className="flex-col" style={{ '--sidebar-width': '15rem' } as CSSProperties}>
        <SiteHeader actions={<ConnectAiDialog />} />
        <div className="flex w-full flex-1">
          <AppSidebar />
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
