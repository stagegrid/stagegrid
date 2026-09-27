import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function CopyField({
  value,
  label,
  multiline,
  className,
}: {
  value: string
  label: string
  multiline?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {multiline ? (
        <pre
          aria-label={label}
          className="bg-muted/50 min-w-0 flex-1 overflow-x-auto rounded-md border p-2 font-mono text-xs whitespace-pre"
        >
          {value}
        </pre>
      ) : (
        <Input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        aria-label={`Copy ${label}`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
