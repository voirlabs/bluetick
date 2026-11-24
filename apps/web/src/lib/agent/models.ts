import { createOpenAI } from '@ai-sdk/openai'
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai'

const baseURL = () => process.env['OPENAI_BASE_URL'] || undefined

/**
 * OpenAI by default. OPENAI_BASE_URL points it at any OpenAI-compatible API
 * (Ollama, OpenRouter, ...); those speak Chat Completions, while OpenAI itself
 * gets the Responses API.
 */
function languageModel(id: string) {
  const openai = createOpenAI({ baseURL: baseURL() })
  const model = baseURL() ? openai.chat(id) : openai(id)
  // Only reasoning models take an effort setting; others reject it.
  if (!/^(gpt-5|o\d)/.test(id)) return model
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { openai: { reasoningEffort: 'low' } } },
    }),
  })
}

/** The agent's model, unless agent.config.ts sets its own. */
export function defaultModel() {
  return languageModel(process.env['OPENAI_MODEL'] || 'gpt-5.4-mini')
}

/** Model for the setup builder chat. */
export function builderModel() {
  return languageModel(process.env['OPENAI_BUILDER_MODEL'] || 'gpt-5.4-mini')
}

/** Knowledge-base embeddings. The database column holds 1536 dimensions. */
export const EMBEDDING_OPTIONS = { openai: { dimensions: 1536 } }

export function embeddingModel() {
  return createOpenAI({ baseURL: baseURL() }).embedding(
    process.env['OPENAI_EMBEDDING_MODEL'] || 'text-embedding-3-small'
  )
}

/** Transcribes customers' voice notes. Needs OpenAI (or a server with /audio/transcriptions). */
export function transcriptionModel() {
  return createOpenAI({ baseURL: baseURL() }).transcription(
    process.env['OPENAI_TRANSCRIBE_MODEL'] || 'gpt-4o-mini-transcribe'
  )
}
