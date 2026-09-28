import '@fontsource/sarabun/400.css'
import '@fontsource/sarabun/600.css'
import './doc.css'

import { useEffect, useMemo } from 'react'

import { ErrorState } from '@/components/page-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { documentHtml } from './preview'
import { useDocument } from './queries'

/** Print view (spec 06 §5.4): the browser's "Save as PDF" handles Thai line breaking correctly. */
export function PrintPage({
  slug,
  docId,
  version,
}: {
  slug: string
  docId: string
  version?: number
}) {
  const { data: doc, isLoading, error } = useDocument(slug, docId, version)
  const html = useMemo(() => (doc ? documentHtml(doc) : ''), [doc])
  useEffect(() => {
    document.documentElement.classList.remove('dark')
    return () => {
      if (localStorage.getItem('stagegrid-theme') !== 'light')
        document.documentElement.classList.add('dark')
    }
  }, [])
  if (isLoading) return <Skeleton className="m-6 h-96" />
  if (error || !doc) return <ErrorState error={error} />
  return (
    <div className="bg-background text-foreground min-h-svh">
      <div className="no-print flex justify-end gap-2 border-b p-3">
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <article
        className="doc-body mx-auto max-w-[21cm] p-10"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
