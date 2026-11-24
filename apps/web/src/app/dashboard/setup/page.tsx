'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Check, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/dashboard/page-header'
import { TickMark } from '@/components/tick-mark'

interface GeneratedConfig {
  name: string
  systemPrompt: string
  businessContext: Record<string, unknown>
  toolsEnabled: string[]
  greetingMessage: string
  fallbackMessage: string
  escalationRules: unknown[]
  allowedTopics: string[]
  language: string
  summary: string
}

const textOf = (m: UIMessage) =>
  m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')

/** The configuration in a finished generateAgentConfig tool call, if this part is one. */
function configOf(part: UIMessage['parts'][number]): GeneratedConfig | null {
  if (part.type !== 'tool-generateAgentConfig' || part.state !== 'output-available') return null
  return (part.output as { config?: GeneratedConfig }).config ?? null
}

const WELCOME =
  'I\'ll ask a few questions, then write your WhatsApp agent\'s configuration.\n\nWhat kind of business is this, and what should the agent do? For example: "I run a dental clinic and want the agent to answer FAQs, collect patient details and request appointments."'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="section-label mb-1">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  )
}

function Preview({ config }: { config: GeneratedConfig }) {
  return (
    <dl className="space-y-4">
      <Field label="Agent name">
        <span className="font-medium text-text">{config.name}</span>
      </Field>
      <Field label="Greeting">{config.greetingMessage}</Field>
      <Field label="Tools">
        <span className="flex flex-wrap gap-1">
          {config.toolsEnabled.map((t) => (
            <span
              key={t}
              className="rounded-md border border-line-2 px-2 py-0.5 font-mono text-xs text-text"
            >
              {t}
            </span>
          ))}
        </span>
      </Field>
      <Field label="Language">{config.language}</Field>
      <Field label="System prompt">
        <pre className="max-h-56 overflow-y-auto rounded-lg bg-field p-3 text-xs whitespace-pre-wrap text-muted">
          {config.systemPrompt}
        </pre>
      </Field>
    </dl>
  )
}

export default function SetupPage() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const [transport] = useState(() => new DefaultChatTransport({ api: '/api/agent/builder' }))
  const { messages, sendMessage, status, error } = useChat<UIMessage>({
    transport,
    messages: [{ id: 'welcome', role: 'assistant', parts: [{ type: 'text', text: WELCOME }] }],
  })
  const isLoading = status === 'submitted' || status === 'streaming'

  // The latest configuration the assistant generated, if any.
  const generatedConfig = useMemo(() => {
    for (const m of [...messages].reverse()) {
      for (const p of [...m.parts].reverse()) {
        const config = configOf(p)
        if (config) return config
      }
    }
    return null
  }, [messages])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    void sendMessage({ text })
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading])

  async function handleSaveAgent() {
    if (!generatedConfig) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generatedConfig),
      })
      if (res.ok) {
        router.push('/dashboard/agent')
        router.refresh()
        return
      }
      const data = await res.json().catch(() => ({}))
      setSaveError(data.error ?? `Saving failed (HTTP ${res.status})`)
    } catch {
      setSaveError('Saving failed. Check your connection and try again.')
    }
    setSaving(false)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        bar
        title="Set up your agent"
        description="Describe your business. The assistant writes the configuration; you can edit everything after."
        actions={
          generatedConfig && (
            <Button onClick={handleSaveAgent} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Save agent
            </Button>
          )
        }
      >
        {saveError && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {saveError}
          </p>
        )}
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto bg-surface p-4 md:p-6"
            role="log"
            aria-live="polite"
            aria-label="Setup conversation"
          >
            {messages.map((m) => {
              const mine = m.role === 'user'
              return (
                <div
                  key={m.id}
                  className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
                >
                  <span className="text-xs text-faint">{mine ? 'You' : 'Setup assistant'}</span>
                  {textOf(m) && (
                    <div
                      className={cn(
                        'max-w-[90%] rounded-2xl border px-4 py-2 text-sm whitespace-pre-wrap md:max-w-prose',
                        mine
                          ? 'rounded-br-sm border-accent-line bg-accent-strong text-text'
                          : 'rounded-bl-sm border-line-2 bg-card text-text'
                      )}
                    >
                      {textOf(m)}
                    </div>
                  )}
                  {m.parts.map((p, i) => {
                    const config = configOf(p)
                    return config ? (
                      <div
                        key={i}
                        className="max-w-[90%] rounded-2xl border border-accent-line bg-accent-strong px-4 py-3 text-sm md:max-w-prose"
                      >
                        <p className="flex items-center gap-2 font-medium text-accent">
                          <TickMark /> Configuration ready
                        </p>
                        <p className="mt-1 text-text">{config.summary}</p>
                        <p className="mt-1 text-xs text-muted">
                          Review it, then click Save agent. Keep chatting to change anything.
                        </p>
                      </div>
                    ) : null
                  })}
                </div>
              )
            })}
            {isLoading && (
              <p className="flex items-center gap-2 text-xs text-faint">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Thinking…
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error.message ||
                  'The model call failed. Check OPENAI_API_KEY and the server logs.'}
              </p>
            )}
          </div>

          <form onSubmit={submit} className="border-t border-line p-3 md:p-4">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe your business and what the agent should do…"
                aria-label="Message the setup assistant"
                className="min-h-14 resize-none"
                rows={2}
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (!isLoading && input.trim()) e.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                aria-label="Send"
              >
                {isLoading ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-faint">Enter sends, Shift+Enter adds a line</p>
          </form>
        </div>

        {generatedConfig && (
          <aside
            aria-label="Generated configuration"
            className="hidden w-80 shrink-0 overflow-y-auto border-l border-line p-5 lg:block"
          >
            <h2 className="section-label mb-4">Generated configuration</h2>
            <Preview config={generatedConfig} />
          </aside>
        )}
      </div>
    </div>
  )
}
