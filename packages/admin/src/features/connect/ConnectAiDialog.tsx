import { BotIcon, DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CopyField } from '@/components/copy-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useCreateToken } from '@/features/tokens/queries'
import { errorMessage } from '@/lib/api'

import { mcpSnippets } from './snippets'

const TOKEN_PLACEHOLDER = '<your token>'

export function ConnectAiDialog() {
  const [token, setToken] = useState<string | null>(null)
  const create = useCreateToken()
  const mcpUrl = `${window.location.origin}/mcp`

  const makeToken = async () => {
    try {
      const date = new Date().toISOString().slice(0, 10)
      setToken((await create.mutateAsync({ name: `AI – ${date}` })).token)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog onOpenChange={(o) => !o && setToken(null)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BotIcon />
          Connect AI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect an AI assistant</DialogTitle>
          <DialogDescription>
            Any assistant that supports MCP can read and update your projects — with your
            permissions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <h3 className="text-sm font-medium">1. MCP server URL</h3>
            <CopyField value={mcpUrl} label="MCP URL" />
          </div>
          <div className="grid gap-1.5">
            <h3 className="text-sm font-medium">2. Token</h3>
            {token ? (
              <>
                <CopyField value={token} label="token" />
                <p className="text-muted-foreground text-xs">
                  Shown once. Manage tokens in Profile.
                </p>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => void makeToken()} disabled={create.isPending}>
                  Create token for AI
                </Button>
                <span className="text-muted-foreground text-xs">
                  or create one in Profile → API tokens
                </span>
              </div>
            )}
          </div>
          <div className="grid gap-3">
            <h3 className="text-sm font-medium">3. Add it to your assistant</h3>
            {mcpSnippets(mcpUrl, token ?? TOKEN_PLACEHOLDER).map((s) => (
              <div key={s.id} className="grid gap-1">
                <p className="text-muted-foreground text-xs">{s.title}</p>
                <CopyField value={s.body} label={`${s.title} config`} multiline />
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <h3 className="text-sm font-medium">claude.ai, ChatGPT, and other apps with sign-in</h3>
            <p className="text-muted-foreground text-xs">
              Add a custom connector with the MCP URL above — no token needed. You'll be asked to
              sign in to Stagegrid and allow access.
            </p>
          </div>
          <div className="grid gap-1.5">
            <h3 className="text-sm font-medium">4. Teach it how Stagegrid works</h3>
            <p className="text-muted-foreground text-xs">
              MCP clients get the guide automatically. For Claude skills or other assistants,
              download the instructions.
            </p>
            <Button variant="outline" size="sm" className="justify-self-start" asChild>
              <a href="/api/v1/skill.zip">
                <DownloadIcon />
                Download AI skill
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
