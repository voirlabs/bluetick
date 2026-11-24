import { describe, expect, it } from 'vitest'
import { monthStart, usageSummary, type UsageCounts } from './usage'

const counts: UsageCounts = {
  inboundByType: { text: 120, audio: 14, image: 6, interactive: 9, button: 1, video: 2 },
  agentReplies: 130,
  personReplies: 12,
  templates: 3,
  conversations: 40,
  handedOff: 6,
  needsPerson: 2,
  inputTokens: 210_000,
  outputTokens: 18_500,
}

describe('usageSummary', () => {
  it('groups customer messages by kind, biggest first', () => {
    const s = usageSummary(counts)
    expect(s.customerMessages).toBe(152)
    expect(s.customerBreakdown).toEqual([
      { label: 'Text', count: 120 },
      { label: 'Voice notes', count: 14 },
      { label: 'Buttons', count: 10 },
      { label: 'Photos', count: 6 },
      { label: 'Other', count: 2 },
    ])
  })

  it('splits replies and counts service messages against the free tier', () => {
    const s = usageSummary(counts)
    expect(s.replies).toBe(145)
    expect(s.replyBreakdown.map((r) => r.label)).toEqual(['Agent', 'You', 'Templates'])
    expect(s.serviceMessages).toBe(142)
    expect(s.freeServiceLeft).toBe(858)
    expect(usageSummary({ ...counts, agentReplies: 1500 }).freeServiceLeft).toBe(0)
  })

  it('works out the handoff rate, and has none without conversations', () => {
    expect(usageSummary(counts).handoffRate).toBe(15)
    expect(usageSummary({ ...counts, conversations: 0, handedOff: 0 }).handoffRate).toBeNull()
  })
})

describe('monthStart', () => {
  it('is midnight UTC on the first', () => {
    expect(monthStart(new Date('2026-11-20T15:30:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})
