'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AgentSettings } from '@bluetick/agent'
import type { KnowledgeSource } from '@prisma/client'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LIMITS } from '@/lib/schemas'
import { SimulatorPanel } from './simulator-panel'
import { KnowledgeSourcesPanel } from './knowledge-sources-panel'
import { BusinessDetailsPanel } from './business-details-panel'
import { SaveStatus, type SaveMessage } from './save-status'

export type AgentTab = 'config' | 'business' | 'knowledge' | 'simulator'

interface Props {
  settings: AgentSettings
  status: string
  knowledgeSources: KnowledgeSource[]
  /** Tools defined in agent.config.ts. */
  availableTools: Array<{ name: string; description: string }>
  initialTab: AgentTab
}

export function AgentCard({
  settings,
  status: initialStatus,
  knowledgeSources,
  availableTools,
  initialTab,
}: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SaveMessage>(null)
  const [name, setName] = useState(settings.name)
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [greetingMessage, setGreetingMessage] = useState(settings.greetingMessage)
  const [fallbackMessage, setFallbackMessage] = useState(settings.fallbackMessage)
  const [toolsEnabled, setToolsEnabled] = useState<string[]>(settings.toolsEnabled)
  const [status, setStatus] = useState(initialStatus)

  function toggleTool(tool: string) {
    setToolsEnabled((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    )
  }

  /** Keeps the tab in the URL, so a reload or a link from the overview opens it. */
  function onTabChange(tab: string) {
    const url = new URL(window.location.href)
    if (tab === 'config') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          systemPrompt,
          greetingMessage,
          fallbackMessage,
          toolsEnabled,
          status,
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
    <Tabs defaultValue={initialTab} onValueChange={onTabChange}>
      <TabsList className="mb-6">
        <TabsTrigger value="config">Settings</TabsTrigger>
        <TabsTrigger value="business">Business</TabsTrigger>
        <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        <TabsTrigger value="simulator">Simulator</TabsTrigger>
      </TabsList>

      <TabsContent value="config">
        <form onSubmit={handleSave}>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Basics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Agent name</Label>
                  <Input
                    id="agent-name"
                    value={name}
                    required
                    maxLength={LIMITS.name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="greeting">Greeting</Label>
                  <Textarea
                    id="greeting"
                    value={greetingMessage}
                    maxLength={LIMITS.message}
                    onChange={(e) => setGreetingMessage(e.target.value)}
                    rows={3}
                    aria-describedby="greeting-hint"
                  />
                  <p id="greeting-hint" className="text-xs text-faint">
                    Opens the agent&apos;s first reply in a conversation. Say it is an AI.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fallback">Fallback message</Label>
                  <Textarea
                    id="fallback"
                    value={fallbackMessage}
                    required
                    maxLength={LIMITS.message}
                    onChange={(e) => setFallbackMessage(e.target.value)}
                    rows={2}
                    aria-describedby="fallback-hint"
                  />
                  <p id="fallback-hint" className="text-xs text-faint">
                    Sent when the model fails or a fallback rule matches.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-line-2 p-4">
                  <div>
                    <p id="status-label" className="text-sm font-medium text-text">
                      Replying to customers
                    </p>
                    <p className="text-xs text-faint">
                      {status === 'active'
                        ? 'On: the agent answers WhatsApp messages.'
                        : 'Paused: new messages wait in the inbox for a person.'}
                    </p>
                  </div>
                  <Switch
                    aria-labelledby="status-label"
                    checked={status === 'active'}
                    onCheckedChange={(v) => setStatus(v ? 'active' : 'paused')}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <label htmlFor="system-prompt">System prompt</label>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  id="system-prompt"
                  value={systemPrompt}
                  required
                  minLength={10}
                  maxLength={LIMITS.systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={16}
                  className="font-mono text-xs"
                />
                <p className="mt-2 text-xs text-faint">
                  Business details, language, topics, escalation rules and WhatsApp rules are added
                  to this automatically. Changes apply from the next reply.
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Tools</CardTitle>
                <p className="text-sm text-muted">
                  Defined in <code>apps/web/agent.config.ts</code>. Switch on the ones this business
                  uses.
                </p>
              </CardHeader>
              <CardContent>
                {availableTools.length === 0 ? (
                  <p className="text-sm text-muted">
                    No tools defined. Add some with <code>defineTool()</code> in{' '}
                    <code>agent.config.ts</code>.
                  </p>
                ) : (
                  <ul className="divide-y divide-line border-y border-line">
                    {availableTools.map((tool) => (
                      <li key={tool.name} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p id={`tool-${tool.name}`} className="font-mono text-sm text-text">
                            {tool.name}
                          </p>
                          <p className="text-xs text-faint">{tool.description}</p>
                        </div>
                        <Switch
                          aria-labelledby={`tool-${tool.name}`}
                          checked={toolsEnabled.includes(tool.name)}
                          onCheckedChange={() => toggleTool(tool.name)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <SaveStatus message={message} />
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Save changes
            </Button>
          </div>
        </form>
      </TabsContent>

      <TabsContent value="business">
        <BusinessDetailsPanel settings={settings} />
      </TabsContent>

      <TabsContent value="knowledge">
        <KnowledgeSourcesPanel sources={knowledgeSources} />
      </TabsContent>

      <TabsContent value="simulator">
        <SimulatorPanel agentName={settings.name} />
      </TabsContent>
    </Tabs>
  )
}
