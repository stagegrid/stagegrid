import { zodResolver } from '@hookform/resolvers/zod'
import type { UserDto } from '@stagegrid/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, EllipsisIcon, UserPlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { FormField } from '@/components/form-field'
import { ErrorState, PageHeader } from '@/components/page-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useMe } from '@/features/auth/queries'
import { api, errorMessage } from '@/lib/api'
import { qk } from '@/lib/query-keys'

interface LinkResult {
  link: string
  expiresAt: string
}

function LinkDialog({
  title,
  result,
  onClose,
}: {
  title: string
  result: LinkResult | null
  onClose: () => void
}) {
  return (
    <Dialog open={result !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Share this link with them. It works once and expires{' '}
            {result && new Date(result.expiresAt).toLocaleString()}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={result?.link ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link"
          />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(result?.link ?? '')
              toast('Link copied')
            }}
          >
            <CopyIcon />
            Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const inviteSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  email: z.email('Enter a valid email'),
  isAdmin: z.boolean(),
})
type InviteValues = z.infer<typeof inviteSchema>

export function UsersPage() {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const {
    data: users,
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: qk.users, queryFn: () => api<UserDto[]>('/admin/users') })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [link, setLink] = useState<{ title: string; result: LinkResult } | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.users })
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { name: '', email: '', isAdmin: false },
  })

  const invite = form.handleSubmit(async (v) => {
    try {
      const res = await api<{ user: UserDto } & LinkResult>('/admin/users', { body: v })
      await refresh()
      setInviteOpen(false)
      form.reset()
      setLink({ title: `Invite link for ${res.user.name}`, result: res })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })
  const issue = async (u: UserDto, kind: 'invite-link' | 'reset-link') => {
    try {
      const res = await api<LinkResult>(`/admin/users/${u.id}/${kind}`, { body: {} })
      setLink({
        title:
          kind === 'invite-link'
            ? `New invite link for ${u.name}`
            : `Password reset link for ${u.name}`,
        result: res,
      })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const patch = (u: UserDto, body: Record<string, unknown>) =>
    action.mutate(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body }))

  return (
    <div>
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlusIcon />
            Invite user
          </Button>
        }
      />
      <div className="p-6">
        {isLoading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {users && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    {u.name} {u.isAdmin && <Badge variant="secondary">Admin</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={u.status === 'active' ? 'outline' : 'secondary'}
                      className="capitalize"
                    >
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.status === 'invited' && (
                          <DropdownMenuItem onClick={() => void issue(u, 'invite-link')}>
                            Copy new invite link
                          </DropdownMenuItem>
                        )}
                        {u.status === 'active' && (
                          <DropdownMenuItem onClick={() => void issue(u, 'reset-link')}>
                            Create reset link
                          </DropdownMenuItem>
                        )}
                        {u.id !== me?.id && (
                          <DropdownMenuItem onClick={() => patch(u, { isAdmin: !u.isAdmin })}>
                            {u.isAdmin ? 'Remove admin' : 'Make admin'}
                          </DropdownMenuItem>
                        )}
                        {u.id !== me?.id && u.status === 'active' && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => patch(u, { status: 'disabled' })}
                          >
                            Disable
                          </DropdownMenuItem>
                        )}
                        {u.status === 'disabled' && (
                          <DropdownMenuItem onClick={() => patch(u, { status: 'active' })}>
                            Enable
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <form onSubmit={invite} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>
                You'll get a link to send them. No email is sent.
              </DialogDescription>
            </DialogHeader>
            <FormField id="invite-name" label="Name" error={form.formState.errors.name?.message}>
              <Input id="invite-name" autoFocus {...form.register('name')} />
            </FormField>
            <FormField id="invite-email" label="Email" error={form.formState.errors.email?.message}>
              <Input id="invite-email" type="email" {...form.register('email')} />
            </FormField>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={form.watch('isAdmin')}
                onCheckedChange={(v) => form.setValue('isAdmin', v === true)}
              />
              Admin (can manage users and create projects)
            </Label>
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Create invite link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <LinkDialog
        title={link?.title ?? ''}
        result={link?.result ?? null}
        onClose={() => setLink(null)}
      />
    </div>
  )
}
