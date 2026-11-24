import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadMedia = vi.fn()
const transcribe = vi.fn()

vi.mock('ai', () => ({ transcribe: (...args: unknown[]) => transcribe(...args) }))
vi.mock('@/lib/agent/models', () => ({ transcriptionModel: () => 'model' }))
vi.mock('@/lib/whatsapp/cloud-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/cloud-api')>()),
  downloadMedia: (...args: unknown[]) => downloadMedia(...args),
}))

const { MAX_VOICE_NOTE_BYTES, readMedia } = await import('./media')
const { MediaTooLargeError } = await import('@/lib/whatsapp/cloud-api')

const voiceNote = {
  id: 'wamid.1',
  from: '15550001111',
  timestamp: new Date(),
  kind: 'voice' as const,
  type: 'audio',
  text: '[Voice note]',
  media: { id: 'media-1' },
}

describe('readMedia', () => {
  beforeEach(() => {
    downloadMedia.mockReset()
    transcribe.mockReset()
  })

  it('transcribes a voice note within the size limit', async () => {
    downloadMedia.mockResolvedValue({ data: new Uint8Array([1]), mimeType: 'audio/ogg' })
    transcribe.mockResolvedValue({ text: ' Table for two ' })
    await expect(readMedia(voiceNote)).resolves.toEqual({ text: '[Voice note] Table for two' })
    expect(downloadMedia).toHaveBeenCalledWith('media-1', MAX_VOICE_NOTE_BYTES)
  })

  it('does not transcribe a long voice note and asks the customer to type instead', async () => {
    downloadMedia.mockRejectedValue(new MediaTooLargeError())
    const result = await readMedia(voiceNote)
    expect(result.text).toContain('too long to transcribe')
    expect(transcribe).not.toHaveBeenCalled()
  })
})
