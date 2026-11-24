import type { z } from 'zod'
import type { AgentDefinition, AnyTool, ToolDefinition } from './types'

/** Declares a tool. Returns it unchanged; the wrapper is there so `input` is typed in `run`. */
export function defineTool<TInput extends z.ZodTypeAny, TOutput>(
  tool: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return tool
}

/** Declares an agent: model, instructions, tools and hooks. */
export function defineAgent(definition: AgentDefinition): AgentDefinition {
  return definition
}

export interface ToolInfo {
  name: string
  description: string
}

/** Tool names and descriptions, for the dashboard and the agent builder. */
export function listTools(definition: AgentDefinition): ToolInfo[] {
  return Object.entries(definition.tools ?? {}).map(([name, tool]: [string, AnyTool]) => ({
    name,
    description: tool.description,
  }))
}
