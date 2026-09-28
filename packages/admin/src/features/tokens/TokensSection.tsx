import { useQuery } from '@tanstack/react-query'
import { KeyRoundIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CopyField } from '@/components/copy-field'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { errorMessage } from '@/lib/api'
import { relativeTime } from '@/lib/format'

import { tokensQuery, useCreateToken, useRevokeToken } from './queries'

const EXPIRY = { never: undefined, '30': 30, '90': 90, '365': 365 } as const

export function TokensSection() {
  const { data: tokens = [] } = useQuery(tokensQuery)
  const create = useCreateToken()
  const revoke = useRevokeToken()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<keyof typeof EXPIRY>('never')
  const [created, setCreated] = useState<string | null>(null)

  const submit = async () => {
    try {
      const res = await create.mutateAsync({ name: name.trim(), expiresInDays: EXPIRY[expiry] })
      setCreated(res.token)
      setName('')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">API tokens</h2>
          <p className="text-muted-foreground text-sm">
            For AI assistants (MCP) and scripts. A token acts as you.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <PlusIcon />
          Create token
        </Button>
      </div>
      {tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tokens yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <KeyRoundIcon className="text-muted-foreground size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate">{t.name}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {t.prefix}… · created {relativeTime(t.createdAt)} ·{' '}
                  {t.lastUsedAt ? `used ${relativeTime(t.lastUsedAt)}` : 'never used'}
                  {t.expiresAt && ` · expires ${relativeTime(t.expiresAt)}`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(t.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setCreated(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? 'Copy your token' : 'Create token'}</DialogTitle>
            <DialogDescription>
              {created
                ? "You won't see it again. Store it somewhere safe."
                : 'Name it after where you’ll use it.'}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <CopyField value={created} label="token" />
          ) : (
            <div className="grid gap-4">
              <FormField id="token-name" label="Name">
                <Input
                  id="token-name"
                  placeholder="Claude on my laptop"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </FormField>
              <FormField id="token-expiry" label="Expires">
                <Select value={expiry} onValueChange={(v) => setExpiry(v as keyof typeof EXPIRY)}>
                  <SelectTrigger id="token-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="30">In 30 days</SelectItem>
                    <SelectItem value="90">In 90 days</SelectItem>
                    <SelectItem value="365">In a year</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          )}
          <DialogFooter>
            {created ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <Button onClick={() => void submit()} disabled={!name.trim() || create.isPending}>
                Create token
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
