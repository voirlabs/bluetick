import { NextRequest, NextResponse, after } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { db } from '@/lib/db'
import { fetchPageText } from '@/lib/fetch-page'
import { indexSource } from '@/lib/knowledge'
import { MAX_SOURCES, idSchema, knowledgeSourceSchema } from '@/lib/schemas'

// Indexing runs in after(): fetching, embedding and storing must fit in this budget.
export const maxDuration = 60

/** Adds a web page or a text snippet and indexes it in the background. */
export async function POST(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = knowledgeSourceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  if ((await db.knowledgeSource.count()) >= MAX_SOURCES) {
    return NextResponse.json({ error: `You can add up to ${MAX_SOURCES} sources` }, { status: 400 })
  }

  const input = parsed.data
  const source = await db.knowledgeSource.create({
    data:
      input.type === 'url'
        ? { type: 'url', name: input.url }
        : { type: 'snippet', name: input.name },
  })
  after(() =>
    indexSource(source.id, async () =>
      input.type === 'url' ? fetchPageText(input.url) : input.content
    )
  )

  return NextResponse.json({ source })
}

export async function DELETE(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = idSchema.safeParse(req.nextUrl.searchParams.get('id'))
  if (!parsed.success) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const id = parsed.data

  const deleted = await db.knowledgeSource.delete({ where: { id } }).catch(() => null)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
