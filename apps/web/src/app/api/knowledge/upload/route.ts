import { NextRequest, NextResponse, after } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { db } from '@/lib/db'
import { MAX_UPLOAD_BYTES, extractFileText, indexSource, uploadKind } from '@/lib/knowledge'
import { declaresLargerBody } from '@/lib/http'
import { logger } from '@/lib/log'
import { MAX_SOURCES } from '@/lib/schemas'

const log = logger('knowledge')

export const maxDuration = 60

/** Extracts the text of an uploaded PDF, TXT or Markdown file and indexes it in the background. */
export async function POST(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Refused before formData() buffers it: the file limit plus room for the form encoding.
  if (declaresLargerBody(req, MAX_UPLOAD_BYTES + 1024 * 1024)) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })
  }
  const file = (await req.formData().catch(() => null))?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }
  if (!uploadKind(file)) {
    return NextResponse.json({ error: 'Upload a PDF, TXT or Markdown file' }, { status: 400 })
  }
  if ((await db.knowledgeSource.count()) >= MAX_SOURCES) {
    return NextResponse.json({ error: `You can add up to ${MAX_SOURCES} sources` }, { status: 400 })
  }

  let text: string
  try {
    text = await extractFileText(file)
  } catch (err) {
    log.warn('could not extract text from upload', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: 'Could not read that file. Is it a valid, unencrypted PDF?' },
      { status: 400 }
    )
  }

  const source = await db.knowledgeSource.create({
    data: { type: 'document', name: file.name.slice(0, 200) },
  })
  after(() => indexSource(source.id, async () => text))

  return NextResponse.json({ source })
}
