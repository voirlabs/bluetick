'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { missingValues, renderTemplate, type Template } from '@/lib/whatsapp/templates'

interface Props {
  conversationId: string
  /** Called after a template is sent, so the conversation reloads. */
  onSent: () => void
}

/**
 * Sends one approved template once the 24-hour window has closed, e.g. a
 * booking confirmation or a follow-up. One message to one customer; no bulk.
 */
export function TemplateComposer({ conversationId, onSent }: Props) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [chosen, setChosen] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const template = templates?.find((t) => `${t.name}|${t.language}` === chosen) ?? null
  const sendable = templates?.filter((t) => !t.unsupported) ?? []
  const skipped = templates?.filter((t) => t.unsupported) ?? []

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/templates', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Could not load templates (HTTP ${res.status})`)
      setTemplates(data.templates as Template[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates')
    } finally {
      setLoading(false)
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!template) return
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/conversations/${conversationId}/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: template.name, language: template.language, values }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Sending failed (HTTP ${res.status})`)
      setChosen('')
      setValues({})
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sending failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-line p-3">
      <p className="text-sm text-warning">
        More than 24 hours since the customer last wrote. WhatsApp only allows an approved template
        until they write again.
      </p>

      {templates === null ? (
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          Send a template
        </Button>
      ) : sendable.length === 0 ? (
        <p className="text-sm text-muted">
          No templates this inbox can send. Create one in WhatsApp Manager → Message templates and wait
          for Meta to approve it.
        </p>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="template-choice">Template</Label>
            <select
              id="template-choice"
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value)
                setValues({})
              }}
              className="h-10 w-full rounded-[10px] border border-line-2 bg-field pr-10 pl-3 text-sm text-text"
            >
              <option value="">Choose an approved template…</option>
              {sendable.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                  {t.name} ({t.language}, {t.category})
                </option>
              ))}
            </select>
          </div>

          {template && (
            <>
              {template.variables.map((v) => (
                <div key={v} className="space-y-2">
                  <Label htmlFor={`var-${v}`}>{`{{${v}}}`}</Label>
                  <Input
                    id={`var-${v}`}
                    value={values[v] ?? ''}
                    maxLength={1024}
                    onChange={(e) => setValues((cur) => ({ ...cur, [v]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <p className="section-label mb-1">The customer sees</p>
                <p className="rounded-lg border border-line-2 bg-card p-3 text-sm whitespace-pre-wrap text-text">
                  {renderTemplate(template, values)}
                </p>
              </div>
              <Button type="submit" size="sm" disabled={sending || missingValues(template, values).length > 0}>
                {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                Send template
              </Button>
            </>
          )}

          {skipped.length > 0 && (
            <details className="text-xs text-faint">
              <summary className="cursor-pointer">
                {skipped.length} template{skipped.length === 1 ? '' : 's'} can&apos;t be sent from here
              </summary>
              <ul className="mt-1 space-y-1">
                {skipped.map((t) => (
                  <li key={`${t.name}|${t.language}`}>
                    <code>{t.name}</code>: {t.unsupported}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
