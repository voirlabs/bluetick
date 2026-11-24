'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { KnowledgeSource } from '@prisma/client'
import { FileText, Link2, Loader2, StickyNote, Trash2, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MAX_SOURCES } from '@/lib/schemas'
import { cn, timeAgo } from '@/lib/utils'

interface Props {
  sources: KnowledgeSource[]
}

const SNIPPET_MAX = 5000

const statusVariant: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  indexed: 'success',
  indexing: 'warning',
  pending: 'secondary',
  failed: 'destructive',
}

const typeIcon = { document: FileText, url: Link2, snippet: StickyNote } as const

export function KnowledgeSourcesPanel({ sources }: Props) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [snippetName, setSnippetName] = useState('')
  const [snippetContent, setSnippetContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const full = sources.length >= MAX_SOURCES

  // Indexing runs in the background; refresh until every source has finished.
  const busy = sources.some((s) => s.indexStatus === 'pending' || s.indexStatus === 'indexing')
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [busy, router])

  /** Sends a request and reports its error, if any. Returns true on success. */
  async function submit(request: () => Promise<Response>) {
    setLoading(true)
    setError('')
    try {
      const res = await request()
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Request failed (HTTP ${res.status})`)
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Request failed. Check your connection.')
      return false
    } finally {
      setLoading(false)
    }
  }

  const postJson = (body: unknown) => () =>
    fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  async function addUrl(e: React.FormEvent) {
    e.preventDefault()
    if (await submit(postJson({ type: 'url', url: urlInput }))) setUrlInput('')
  }

  async function addSnippet(e: React.FormEvent) {
    e.preventDefault()
    if (await submit(postJson({ type: 'snippet', name: snippetName, content: snippetContent }))) {
      setSnippetName('')
      setSnippetContent('')
    }
  }

  async function uploadFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    await submit(() => fetch('/api/knowledge/upload', { method: 'POST', body: form }))
    if (fileRef.current) fileRef.current.value = ''
  }

  async function deleteSource(source: KnowledgeSource) {
    if (!window.confirm(`Remove "${source.name}" from the knowledge base?`)) return
    setDeleting(source.id)
    await submit(() =>
      fetch(`/api/knowledge?id=${encodeURIComponent(source.id)}`, { method: 'DELETE' })
    )
    setDeleting(null)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Add a source</CardTitle>
          <p className="text-sm text-muted">
            The agent searches these with the answerFromKnowledge tool before answering.
          </p>
        </CardHeader>
        <CardContent>
          {full ? (
            <p className="rounded-lg border border-line-2 p-3 text-sm text-muted">
              You have {MAX_SOURCES} sources, the maximum. Remove one to add another.
            </p>
          ) : (
            <Tabs defaultValue="url">
              <TabsList className="mb-5">
                <TabsTrigger value="url">Web page</TabsTrigger>
                <TabsTrigger value="file">Document</TabsTrigger>
                <TabsTrigger value="snippet">Snippet</TabsTrigger>
              </TabsList>

              <TabsContent value="url">
                <form onSubmit={addUrl} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="source-url">Page URL</Label>
                    <Input
                      id="source-url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://example.com/faq"
                      type="url"
                      required
                      aria-describedby="source-url-hint"
                    />
                    <p id="source-url-hint" className="text-xs text-faint">
                      A public page. Its text is fetched once and indexed; add it again to refresh.
                    </p>
                  </div>
                  <Button type="submit" disabled={!urlInput.trim() || loading}>
                    {loading ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Link2 aria-hidden />
                    )}
                    Add page
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="file">
                <label
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    const f = e.dataTransfer.files[0]
                    if (f && !loading) uploadFile(f)
                  }}
                  className={cn(
                    'block cursor-pointer rounded-lg border border-dashed border-line-2 p-8 text-center transition-colors focus-within:ring-2 focus-within:ring-accent-2 hover:border-accent-line',
                    dragging && 'border-accent bg-accent-strong'
                  )}
                >
                  {loading ? (
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-muted" aria-hidden />
                  ) : (
                    <Upload className="mx-auto mb-3 h-6 w-6 text-muted" aria-hidden />
                  )}
                  <span className="block text-sm font-medium text-text">
                    {loading ? 'Uploading…' : 'Choose a file or drop it here'}
                  </span>
                  <span className="mt-1 block text-xs text-faint">
                    PDF, TXT or Markdown, up to 10 MB
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    className="sr-only"
                    disabled={loading}
                    accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadFile(f)
                    }}
                  />
                </label>
              </TabsContent>

              <TabsContent value="snippet">
                <form onSubmit={addSnippet} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="snippet-name">Name</Label>
                    <Input
                      id="snippet-name"
                      value={snippetName}
                      required
                      maxLength={200}
                      onChange={(e) => setSnippetName(e.target.value)}
                      placeholder="Parking and access"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="snippet-content">Content</Label>
                    <Textarea
                      id="snippet-content"
                      value={snippetContent}
                      required
                      onChange={(e) => setSnippetContent(e.target.value)}
                      rows={6}
                      placeholder="FAQs, policies, prices..."
                      maxLength={SNIPPET_MAX}
                    />
                    <p className="text-right text-xs text-faint">
                      {snippetContent.length}/{SNIPPET_MAX}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={!snippetContent.trim() || !snippetName.trim() || loading}
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <StickyNote aria-hidden />
                    )}
                    Add snippet
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              Sources{' '}
              <span className="font-medium tabular-nums text-faint">
                {sources.length}/{MAX_SOURCES}
              </span>
            </span>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Indexing" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <div className="py-10 text-center">
              <p className="display text-2xl text-text">No sources yet</p>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
                Add your FAQ page, a menu or price list, or paste your policies as a snippet.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {sources.map((source) => {
                const Icon = typeIcon[source.type as keyof typeof typeIcon] ?? FileText
                return (
                  <li key={source.id} className="flex items-start justify-between gap-3 py-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text" title={source.name}>
                        {source.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge
                          variant={statusVariant[source.indexStatus] ?? 'secondary'}
                          className="capitalize"
                        >
                          {source.indexStatus}
                        </Badge>
                        {source.indexedAt && source.indexStatus === 'indexed' && (
                          <span className="text-xs text-faint">{timeAgo(source.indexedAt)}</span>
                        )}
                      </div>
                      {source.indexStatus === 'failed' && source.errorMessage && (
                        <p className="mt-1 text-xs text-danger">{source.errorMessage}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-danger"
                      onClick={() => deleteSource(source)}
                      disabled={deleting === source.id}
                      aria-label={`Remove ${source.name}`}
                    >
                      {deleting === source.id ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 aria-hidden />
                      )}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
