import { describe, expect, it } from 'vitest'
import { runAgent, type AgentContext } from '@bluetick/agent'
import { mockModel, testRun } from '@bluetick/agent/testing'
import agent, { MAX_PARTY_SIZE, nearestSlots, slotsFor } from './agent.config'

// 2026-11-20 is a Friday, 2026-11-23 a Monday.
const FRIDAY = '2026-11-20'
const MONDAY = '2026-11-23'

describe('availability rules', () => {
  it('is closed on Mondays', () => {
    expect(slotsFor(MONDAY, 2)).toEqual({ slots: [], reason: 'We are closed that day.' })
  })

  it('offers 30-minute slots within seating hours', () => {
    const { slots } = slotsFor(FRIDAY, 2)
    expect(slots[0]).toBe('17:00')
    expect(slots.at(-1)).toBe('22:30')
    expect(slots).toContain('19:30')
  })

  it('sends large parties to the team', () => {
    expect(slotsFor(FRIDAY, MAX_PARTY_SIZE + 1).slots).toEqual([])
  })

  it('picks the slots closest to the preferred time', () => {
    expect(nearestSlots(slotsFor(FRIDAY, 2).slots, '19:00')).toEqual(['18:30', '19:00', '19:30'])
  })
})

describe('restaurant agent', () => {
  it('offers times as buttons and sends no extra text', async () => {
    const model = mockModel([
      {
        toolCalls: [
          {
            name: 'checkAvailability',
            args: { date: FRIDAY, partySize: 2, preferredTime: '19:00' },
          },
        ],
      },
      { text: '' },
    ])
    const { input, record } = testRun(agent, 'Table for 2 on Friday around 7?', { model })
    const result = await runAgent(input)

    expect(result.reply).toBeNull()
    expect(record.sent).toHaveLength(1)
    expect(record.sent[0]).toMatchObject({
      type: 'buttons',
      body: { buttons: [{ title: '18:30' }, { title: '19:00' }, { title: '19:30' }] },
    })
    expect(record.memory.get('pendingRequest')).toEqual({ date: FRIDAY, partySize: 2 })
  })

  it('records a booking request for a valid slot', async () => {
    const model = mockModel([
      {
        toolCalls: [
          {
            name: 'requestTable',
            args: { date: FRIDAY, time: '19:00', partySize: 2, name: 'Sam' },
          },
        ],
      },
      { text: 'Thanks Sam, the team will confirm shortly.' },
    ])
    const { input, record } = testRun(agent, '7pm please, name is Sam', { model })
    const result = await runAgent(input)

    expect(result.reply).toContain('confirm')
    expect(record.bookings).toEqual([
      { requestedFor: `${FRIDAY} 19:00`, partySize: 2, customerName: 'Sam', notes: undefined },
    ])
  })

  it('refuses a time outside seating hours', async () => {
    const model = mockModel([
      {
        toolCalls: [
          {
            name: 'requestTable',
            args: { date: MONDAY, time: '19:00', partySize: 2, name: 'Sam' },
          },
        ],
      },
      { text: 'Sorry, we are closed on Mondays.' },
    ])
    const { input, record } = testRun(agent, 'Monday 7pm', { model })
    const result = await runAgent(input)

    expect(record.bookings).toHaveLength(0)
    expect(result.toolCalls[0]?.output).toMatchObject({ requested: false })
  })

  it('answers "menu" without calling the model', async () => {
    const { input } = testRun(agent, 'Menu?', {
      model: mockModel([{ text: 'should not be used' }]),
    })
    const result = await runAgent(input)
    expect(result.source).toBe('hook')
    expect(result.reply).toContain('menu')
  })

  it('reminds the model which date and party size a tapped time belongs to', async () => {
    const { input, record } = testRun(agent, '19:00', { model: mockModel([{ text: '' }]) })
    record.memory.set('pendingRequest', { date: FRIDAY, partySize: 2 })
    if (typeof agent.instructions !== 'function')
      throw new Error('expected an instructions function')
    const prompt = await agent.instructions({
      settings: input.settings,
      customer: input.customer,
      defaults: '',
      ctx: { ...input.services } as unknown as AgentContext,
    })
    expect(prompt).toContain(`You last offered times on ${FRIDAY} for 2.`)
  })
})
