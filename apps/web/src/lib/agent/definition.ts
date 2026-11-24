import {
  listTools,
  type AgentDefinition,
  type AgentSettings,
  type EscalationRule,
} from '@bluetick/agent'
import type { Agent } from '@prisma/client'
import { db } from '@/lib/db'
import definition from '../../../agent.config'

export const agentDefinition: AgentDefinition = definition

/** Tools available to switch on in the dashboard. */
export const availableTools = listTools(agentDefinition)

/** Each deployment runs exactly one agent, stored under this id. */
export const AGENT_ID = 'default'

export function getAgent() {
  return db.agent.findUnique({ where: { id: AGENT_ID } })
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function businessOf(agent: Agent): AgentSettings['business'] {
  const value = agent.businessContext
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AgentSettings['business'])
    : {}
}

/** Maps the database row to the settings shape the agent runtime expects. */
export function toAgentSettings(agent: Agent): AgentSettings {
  return {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    business: businessOf(agent),
    toolsEnabled: asArray<string>(agent.toolsEnabled),
    greetingMessage: agent.greetingMessage,
    fallbackMessage: agent.fallbackMessage,
    escalationRules: asArray<EscalationRule>(agent.escalationRules),
    allowedTopics: asArray<string>(agent.allowedTopics),
    language: agent.language,
  }
}

/** Drops tool names that are not defined in agent.config.ts. */
export function knownTools(names: string[]) {
  const known = new Set(availableTools.map((t) => t.name))
  return names.filter((n) => known.has(n))
}
