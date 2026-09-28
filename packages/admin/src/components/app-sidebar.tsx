import { Link } from '@tanstack/react-router'
import { FolderKanbanIcon, LayoutGridIcon, UsersIcon } from 'lucide-react'
import type * as React from 'react'

import { NavUser } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar'
import { useMe } from '@/features/auth/queries'
import { useProjects } from '@/features/projects/queries'
import { cn } from '@/lib/utils'

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: me } = useMe()
  const { data: projects, isLoading } = useProjects()

  return (
    <Sidebar
      collapsible="offcanvas"
      className={cn('top-14! h-[calc(100svh-3.5rem)]!', className)}
      {...props}
    >
      <SidebarContent className="gap-2 px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link
                    to="/projects"
                    activeOptions={{ exact: true }}
                    activeProps={{ 'data-active': true }}
                  >
                    <LayoutGridIcon />
                    <span>All projects</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading && [0, 1, 2].map((i) => <SidebarMenuSkeleton key={i} />)}
              {projects?.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/p/$slug"
                      params={{ slug: p.slug }}
                      activeProps={{ 'data-active': true }}
                    >
                      <FolderKanbanIcon />
                      <span className="truncate">{p.name}</span>
                      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                        {Math.round(p.stats.percent)}%
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {me?.isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/admin/users" activeProps={{ 'data-active': true }}>
                      <UsersIcon />
                      <span>Users</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-sidebar-border border-t p-3">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
