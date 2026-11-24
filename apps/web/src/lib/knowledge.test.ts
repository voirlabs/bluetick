import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chunkText, extractFileText, uploadKind } from './knowledge'

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('   ')).toEqual([])
  })

  it('keeps short text in one chunk', () => {
    expect(chunkText('Free parking after 6pm.')).toEqual(['Free parking after 6pm.'])
  })

  it('splits long text into overlapping chunks without a trailing duplicate', () => {
    const chunks = chunkText(words(1000), 500, 50)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]!.split(' ')).toHaveLength(500)
    expect(chunks[1]!.startsWith('w450 ')).toBe(true)
    expect(chunks[2]!.endsWith('w999')).toBe(true)
  })
})

describe('uploadKind', () => {
  it('accepts PDFs, text and Markdown by MIME type or extension', () => {
    expect(uploadKind({ name: 'menu.pdf', type: 'application/pdf' })).toBe('pdf')
    expect(uploadKind({ name: 'faq.md', type: '' })).toBe('text')
    expect(uploadKind({ name: 'faq.MD', type: 'text/x-markdown' })).toBe('text')
    expect(uploadKind({ name: 'notes.txt', type: 'text/plain' })).toBe('text')
    expect(uploadKind({ name: 'photo.png', type: 'image/png' })).toBeNull()
  })
})

describe('extractFileText', () => {
  it('reads the text of a real PDF', async () => {
    // Printed from HTML with headless Chrome (--print-to-pdf).
    const bytes = readFileSync(new URL('./__fixtures__/policies.pdf', import.meta.url))
    const file = new File([bytes], 'policies.pdf', { type: 'application/pdf' })
    const text = await extractFileText(file)
    expect(text).toContain('Harbour Bistro: house policies')
    expect(text).toContain('Corkage is £12 per bottle.')
  })

  it('rejects a file that is not really a PDF', async () => {
    const file = new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' })
    await expect(extractFileText(file)).rejects.toThrow()
  })

  it('reads Markdown as UTF-8 text', async () => {
    const file = new File(['# Café hours\nOpen 9–5'], 'hours.md', { type: '' })
    await expect(extractFileText(file)).resolves.toBe('# Café hours\nOpen 9–5')
  })
})
