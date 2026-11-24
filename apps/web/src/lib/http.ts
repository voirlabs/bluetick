/** True when the request says its body is larger than `maxBytes`. */
export function declaresLargerBody(req: Request, maxBytes: number) {
  return Number(req.headers.get('content-length') ?? 0) > maxBytes
}

/** The body as text, or null once it passes `maxBytes`, without reading the rest. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string | null> {
  if (declaresLargerBody(req, maxBytes)) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
