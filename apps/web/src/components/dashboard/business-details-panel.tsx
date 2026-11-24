'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AgentSettings, EscalationRule } from '@bluetick/agent'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fieldClass, Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { SaveStatus, type SaveMessage } from './save-status'

const TEXT_FIELDS = [
  { key: 'businessName', label: 'Business name', placeholder: 'Harbour Bistro', max: 200 },
  { key: 'industry', label: 'Industry', placeholder: 'Restaurant', max: 100 },
  {
    key: 'hours',
    label: 'Opening hours',
    placeholder: 'Tue-Sun 17:00-22:30, closed Monday',
    max: 500,
  },
  { key: 'timezone', label: 'Timezone', placeholder: 'Europe/London', max: 100 },
  { key: 'location', label: 'Address', placeholder: '1 Quay Street, Bristol', max: 500 },
] as const

const CONDITIONS: Array<{ value: EscalationRule['condition']; label: string; hint: string }> = [
  { value: 'keyword', label: 'Message contains', hint: 'refund' },
  { value: 'intent', label: 'Customer wants', hint: 'to cancel a booking' },
  { value: 'sentiment', label: 'Customer seems', hint: 'angry' },
  { value: 'attempts_exceeded', label: 'Unresolved after', hint: '3' },
]

const selectClass = cn(fieldClass, 'h-10 w-auto pr-10')

/** An optional coordinate: undefined when empty, NaN when not a number in range. */
function toCoordinate(value: string, max: number) {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) <= max ? n : NaN
}

export function BusinessDetailsPanel({ settings }: { settings: AgentSettings }) {
  const router = useRouter()
  const b = settings.business
  const [fields, setFields] = useState<Record<string, string>>({
    businessName: b.businessName ?? '',
    industry: b.industry ?? '',
    description: b.description ?? '',
    hours: b.hours ?? '',
    timezone: b.timezone ?? '',
    location: b.location ?? '',
    latitude: b.latitude?.toString() ?? '',
    longitude: b.longitude?.toString() ?? '',
  })
  const [language, setLanguage] = useState(settings.language)
  const [topics, setTopics] = useState(settings.allowedTopics.join(', '))
  const [rules, setRules] = useState<EscalationRule[]>(settings.escalationRules)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SaveMessage>(null)

  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }))
  const setRule = (i: number, patch: Partial<EscalationRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const latitude = toCoordinate(fields['latitude'] ?? '', 90)
  const longitude = toCoordinate(fields['longitude'] ?? '', 180)
  const coordinateError =
    Number.isNaN(latitude) || Number.isNaN(longitude)
      ? 'Latitude must be between -90 and 90, longitude between -180 and 180.'
      : (latitude === undefined) !== (longitude === undefined)
        ? 'Set both latitude and longitude, or neither.'
        : null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (coordinateError) {
      setMessage({ ok: false, text: coordinateError })
      return
    }
    setSaving(true)
    setMessage(null)
    const businessContext = {
      ...Object.fromEntries(
        Object.entries(fields)
          .filter(([k, v]) => k !== 'latitude' && k !== 'longitude' && v.trim() !== '')
          .map(([k, v]) => [k, v.trim()])
      ),
      latitude,
      longitude,
    }
    try {
      const res = await fetch('/api/agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessContext,
          language,
          allowedTopics: topics
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          escalationRules: rules.filter((r) => r.value.trim() !== ''),
        }),
      })
      const data = await res.json().catch(() => ({}))
      setMessage(
        res.ok ? { ok: true, text: 'Saved' } : { ok: false, text: data.error ?? 'Saving failed' }
      )
      if (res.ok) router.refresh()
    } catch {
      setMessage({ ok: false, text: 'Saving failed. Check your connection.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                value={fields[f.key]}
                maxLength={f.max}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="description">About the business</Label>
            <Textarea
              id="description"
              rows={3}
              maxLength={2000}
              value={fields['description']}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['latitude', 'longitude'] as const).map((key) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key} className="capitalize">
                  {key}
                </Label>
                <Input
                  id={key}
                  inputMode="decimal"
                  aria-invalid={coordinateError ? true : undefined}
                  value={fields[key]}
                  placeholder={key === 'latitude' ? '51.4500' : '-2.5970'}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-faint">
            With coordinates set, the sendLocation tool sends a map pin. Timezone is used by tools
            that work with dates, such as bookings.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Language and topics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="language">Default language</Label>
              <Input
                id="language"
                required
                minLength={2}
                maxLength={20}
                value={language}
                placeholder="en"
                onChange={(e) => setLanguage(e.target.value)}
              />
              <p className="text-xs text-faint">
                The agent replies in the customer&apos;s language and falls back to this one.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="topics">Allowed topics</Label>
              <Input
                id="topics"
                value={topics}
                placeholder="bookings, menu, opening hours"
                onChange={(e) => setTopics(e.target.value)}
              />
              <p className="text-xs text-faint">
                Comma-separated. Leave empty to allow anything about the business.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Escalation rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rules.length === 0 && (
              <p className="text-sm text-muted">
                No rules. The agent still hands off when the requestHuman tool is on and the
                customer asks for a person.
              </p>
            )}
            {rules.map((rule, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-line-2 p-3">
                <div className="flex gap-2">
                  <select
                    aria-label={`Rule ${i + 1} condition`}
                    className={selectClass}
                    value={rule.condition}
                    onChange={(e) => {
                      const condition = e.target.value as EscalationRule['condition']
                      // Only keyword rules run in code, so only they can send the fallback.
                      setRule(
                        i,
                        condition === 'keyword' ? { condition } : { condition, action: 'handoff' }
                      )
                    }}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label={`Rule ${i + 1} value`}
                    maxLength={200}
                    className="min-w-0 flex-1"
                    value={rule.value}
                    placeholder={CONDITIONS.find((c) => c.value === rule.condition)?.hint}
                    onChange={(e) => setRule(i, { value: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <select
                    aria-label={`Rule ${i + 1} action`}
                    className={selectClass}
                    value={rule.action}
                    disabled={rule.condition !== 'keyword'}
                    onChange={(e) =>
                      setRule(i, { action: e.target.value as EscalationRule['action'] })
                    }
                  >
                    <option value="handoff">Hand off</option>
                    <option value="fallback">Send fallback</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRules((rs) => [...rs, { condition: 'keyword', value: '', action: 'handoff' }])
              }
            >
              <Plus aria-hidden /> Add rule
            </Button>
            <p className="text-xs text-faint">
              Keyword rules run before the model. The others are instructions to the model and need
              the requestHuman tool switched on.
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <SaveStatus message={message} />
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Save business details
          </Button>
        </div>
      </div>
    </form>
  )
}
