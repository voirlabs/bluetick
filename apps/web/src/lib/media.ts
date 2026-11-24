import { transcribe } from 'ai'
import type { InboundImage } from '@bluetick/agent'
import { transcriptionModel } from '@/lib/agent/models'
import { logger } from '@/lib/log'
import { MediaTooLargeError, downloadMedia } from '@/lib/whatsapp/cloud-api'
import type { InboundWhatsAppMessage } from '@/lib/whatsapp/webhook'

const log = logger('media')

/** About 15 minutes of WhatsApp audio. Longer voice notes aren't transcribed, which caps the cost. */
export const MAX_VOICE_NOTE_BYTES = 2 * 1024 * 1024

/**
 * What the agent reads for a voice note or photo: the voice note's transcript,
 * or the photo itself. Never throws. When the media can't be fetched or
 * transcribed, the text tells the agent what it missed so it can ask.
 */
export async function readMedia(
  msg: InboundWhatsAppMessage
): Promise<{ text: string; image?: InboundImage }> {
  if (!msg.media) return { text: msg.text }
  try {
    const { data, mimeType } = await downloadMedia(
      msg.media.id,
      msg.kind === 'voice' ? MAX_VOICE_NOTE_BYTES : undefined
    )
    if (msg.kind === 'voice') {
      const { text } = await transcribe({ model: transcriptionModel(), audio: data })
      const transcript = text.trim()
      return {
        text: transcript
          ? `[Voice note] ${transcript}`
          : '[The customer sent a voice note with no words in it.]',
      }
    }
    return { text: msg.text, image: { data, mediaType: mimeType.split(';')[0]!.trim() } }
  } catch (err) {
    if (err instanceof MediaTooLargeError && msg.kind === 'voice') {
      return {
        text: '[The customer sent a voice note too long to transcribe. Briefly ask them to type it or send a shorter one.]',
      }
    }
    log.error('could not read media', err, { messageId: msg.id, kind: msg.kind })
    return {
      text:
        msg.kind === 'voice'
          ? '[The customer sent a voice note that could not be transcribed. Ask them to type it.]'
          : `${msg.text} [The photo could not be loaded. Ask them to describe it.]`,
    }
  }
}
