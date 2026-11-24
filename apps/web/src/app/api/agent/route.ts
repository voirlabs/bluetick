import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { isSignedIn } from '@/lib/auth'
import { db } from '@/lib/db'
import { agentConfigSchema, agentUpdateSchema } from '@/lib/schemas'
import { AGENT_ID, getAgent, knownTools, toAgentSettings } from '@/lib/agent/definition'

function invalid(error: z.ZodError) {
  const issue = error.issues[0]
  const field = issue?.path.join('.') || 'input'
  return NextResponse.json(
    { error: `Invalid ${field}: ${issue?.message ?? 'check the value'}` },
    { status: 400 }
  )
}

/** Saves the whole configuration from the setup builder, creating the agent on first run. */
export async function PUT(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = agentConfigSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalid(parsed.error)

  const data = { ...parsed.data, toolsEnabled: knownTools(parsed.data.toolsEnabled) }
  // Running setup again keeps business details the assistant doesn't ask
  // about, such as map coordinates.
  const existing = await getAgent()
  const businessContext = {
    ...(existing ? toAgentSettings(existing).business : {}),
    ...data.businessContext,
  }
  const agent = await db.agent.upsert({
    where: { id: AGENT_ID },
    create: { id: AGENT_ID, ...data, status: 'active' },
    update: { ...data, businessContext },
  })
  return NextResponse.json({ agent })
}

/** Updates some settings from the agent page. */
export async function PATCH(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getAgent())) {
    return NextResponse.json({ error: 'Set up the agent first' }, { status: 404 })
  }

  const parsed = agentUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalid(parsed.error)

  const { toolsEnabled, ...rest } = parsed.data
  const agent = await db.agent.update({
    where: { id: AGENT_ID },
    data: { ...rest, ...(toolsEnabled ? { toolsEnabled: knownTools(toolsEnabled) } : {}) },
  })
  return NextResponse.json({ agent })
}
