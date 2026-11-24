import { describe, expect, it } from 'vitest'
import { declaresLargerBody, readBodyText } from './http'

function streamed(chunks: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
      controller.close()
    },
  })
  return new Request('https://app.example/api', { method: 'POST', body, duplex: 'half' } as RequestInit)
}

describe('readBodyText', () => {
  it('reads a body within the limit', async () => {
    await expect(readBodyText(new Request('https://a.example', { method: 'POST', body: 'hello' }), 10)).resolves.toBe('hello')
  })

  it('refuses a declared Content-Length over the limit without reading', async () => {
    const req = new Request('https://a.example', { method: 'POST', body: 'x', headers: { 'content-length': '2000000' } })
    expect(declaresLargerBody(req, 1_000_000)).toBe(true)
    await expect(readBodyText(req, 1_000_000)).resolves.toBeNull()
  })

  it('stops reading a streamed body once it passes the limit', async () => {
    await expect(readBodyText(streamed(['12345', '67890', 'abc']), 8)).resolves.toBeNull()
    await expect(readBodyText(streamed(['1234', '5678']), 8)).resolves.toBe('12345678')
  })
})
