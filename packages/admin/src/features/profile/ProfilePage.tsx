import { zodResolver } from '@hookform/resolvers/zod'
import { passwordSchema } from '@stagegrid/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { FormField } from '@/components/form-field'
import { PageHeader } from '@/components/page-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMe } from '@/features/auth/queries'
import { api, errorMessage } from '@/lib/api'
import { qk } from '@/lib/query-keys'

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) })
const pwSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: "Passwords don't match",
  })

/** Phase 2 adds the API tokens section below these forms. */
export function ProfilePage({ extra }: { extra?: React.ReactNode }) {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const nameForm = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    values: { name: me?.name ?? '' },
  })
  const pwForm = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) })

  const saveName = nameForm.handleSubmit(async (v) => {
    try {
      queryClient.setQueryData(qk.me, await api('/me', { method: 'PATCH', body: v }))
      toast('Name saved')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })
  const savePw = pwForm.handleSubmit(async (v) => {
    try {
      await api('/me/password', {
        body: { currentPassword: v.currentPassword, newPassword: v.newPassword },
      })
      pwForm.reset()
      toast('Password changed. Other sessions were signed out.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })

  return (
    <div>
      <PageHeader title="Profile" description={me?.email} />
      <div className="grid max-w-xl gap-10 p-6">
        <form onSubmit={saveName} className="grid gap-4">
          <h2 className="text-base font-semibold">Name</h2>
          <FormField id="me-name" label="Name" error={nameForm.formState.errors.name?.message}>
            <Input id="me-name" {...nameForm.register('name')} />
          </FormField>
          <Button type="submit" className="justify-self-start">
            Save name
          </Button>
        </form>
        <form onSubmit={savePw} className="grid gap-4">
          <h2 className="text-base font-semibold">Password</h2>
          <FormField
            id="pw-current"
            label="Current password"
            error={pwForm.formState.errors.currentPassword?.message}
          >
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              {...pwForm.register('currentPassword')}
            />
          </FormField>
          <FormField
            id="pw-new"
            label="New password"
            hint="At least 10 characters"
            error={pwForm.formState.errors.newPassword?.message}
          >
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              {...pwForm.register('newPassword')}
            />
          </FormField>
          <FormField
            id="pw-confirm"
            label="Confirm new password"
            error={pwForm.formState.errors.confirm?.message}
          >
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              {...pwForm.register('confirm')}
            />
          </FormField>
          <Button type="submit" className="justify-self-start">
            Change password
          </Button>
        </form>
        {extra}
      </div>
    </div>
  )
}
