import { embed, embedMany } from 'ai'
import { db } from '@/lib/db'
import { logger } from '@/lib/log'
import { EMBEDDING_OPTIONS, embeddingModel } from '@/lib/agent/models'

const log = logger('knowledge')

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const CHUNK_WORDS = 500
const CHUNK_OVERLAP = 50

/** Splits text into overlapping chunks of about 500 words. */
export function chunkText(text: string, size = CHUNK_WORDS, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '))
    if (i + size >= words.length) break
  }
  return chunks
}

/**
 * How an upload is read: 'pdf', 'text', or null if unsupported. Browsers often
 * send Markdown with an empty or vendor MIME type, so the extension counts too.
 */
export function uploadKind(file: { name: string; type: string }): 'pdf' | 'text' | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    file.type === 'text/plain' ||
    file.type === 'text/markdown' ||
    ['txt', 'md', 'markdown'].includes(ext)
  ) {
    return 'text'
  }
  return null
}

/** Extracts plain text from an uploaded PDF, text or Markdown file. */
export async function extractFileText(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())
  if (uploadKind(file) === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    return (await extractText(pdf, { mergePages: true })).text
  }
  return bytes.toString('utf-8')
}

/**
 * Chunks, embeds and stores the text for a source, then marks it indexed. On
 * failure the source is marked failed with the reason, which the dashboard shows.
 */
export async function indexSource(sourceId: string, loadText: () => Promise<string>) {
  try {
    await db.knowledgeSource.update({ where: { id: sourceId }, data: { indexStatus: 'indexing' } })
    const text = (await loadText()).trim()
    if (!text) throw new Error('No text found')

    const chunks = chunkText(text)
    const { embeddings } = await embedMany({
      model: embeddingModel(),
      values: chunks,
      providerOptions: EMBEDDING_OPTIONS,
    })

    await db.$transaction([
      db.knowledgeChunk.deleteMany({ where: { sourceId } }),
      ...chunks.map(
        (content, i) => db.$executeRaw`
          INSERT INTO knowledge_chunks (id, source_id, content, chunk_index, embedding, created_at)
          VALUES (${crypto.randomUUID()}, ${sourceId}, ${content}, ${i}, ${`[${embeddings[i]!.join(',')}]`}::vector, NOW())
        `
      ),
      db.knowledgeSource.update({
        where: { id: sourceId },
        data: { indexStatus: 'indexed', indexedAt: new Date(), errorMessage: null },
      }),
    ])
    log.info('indexed source', { sourceId, chunks: chunks.length })
  } catch (err) {
    log.error('indexing failed', err, { sourceId })
    await db.knowledgeSource
      .update({
        where: { id: sourceId },
        data: {
          indexStatus: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => {})
  }
}

/** The chunks closest to `query`. Throws if the embedding call fails. */
export async function searchKnowledge(query: string, topK = 5): Promise<string[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: query,
    providerOptions: EMBEDDING_OPTIONS,
  })
  const rows = await db.$queryRaw<Array<{ content: string }>>`
    SELECT content
    FROM knowledge_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${`[${embedding.join(',')}]`}::vector
    LIMIT ${topK}
  `
  return rows.map((r) => r.content)
}
