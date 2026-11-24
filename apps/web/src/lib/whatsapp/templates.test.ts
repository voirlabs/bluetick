import { describe, expect, it } from 'vitest'
import { missingValues, parseTemplate, renderTemplate, templateComponents, type RawTemplate } from './templates'

const booking: RawTemplate = {
  name: 'booking_confirmation',
  language: 'en_GB',
  category: 'UTILITY',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Harbour Bistro' },
    { type: 'BODY', text: 'Hi {{1}}, your table for {{2}} is confirmed. See you {{3}}!' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Cancel' }] },
  ],
}

describe('parseTemplate', () => {
  it('reads numbered body variables and builds the preview', () => {
    const t = parseTemplate(booking)
    expect(t).toMatchObject({ variables: ['1', '2', '3'], named: false, unsupported: null, category: 'utility' })
    expect(t.preview).toBe('Harbour Bistro\n\nHi {{1}}, your table for {{2}} is confirmed. See you {{3}}!')
  })

  it('reads named variables once each', () => {
    const t = parseTemplate({
      name: 'order_update',
      language: 'en',
      parameter_format: 'NAMED',
      components: [{ type: 'BODY', text: 'Hi {{first_name}}, order {{order_id}} shipped. Thanks {{first_name}}!' }],
    })
    expect(t.variables).toEqual(['first_name', 'order_id'])
    expect(t.named).toBe(true)
  })

  it('explains templates a form cannot fill', () => {
    const media = parseTemplate({ ...booking, components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }] })
    expect(media.unsupported).toContain('image header')
    const link = parseTemplate({
      ...booking,
      components: [{ type: 'BODY', text: 'Track it' }, { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://x.co/{{1}}' }] }],
    })
    expect(link.unsupported).toContain('link variable')
    expect(parseTemplate({ ...booking, category: 'AUTHENTICATION' }).unsupported).toContain('one-time codes')
  })
})

describe('filling a template', () => {
  const t = parseTemplate(booking)
  const values = { '1': 'Sam', '2': '4', '3': 'Friday at 8pm' }

  it('renders what the customer sees and lists missing values', () => {
    expect(renderTemplate(t, values)).toContain('Hi Sam, your table for 4 is confirmed. See you Friday at 8pm!')
    expect(missingValues(t, { '1': 'Sam', '2': ' ' })).toEqual(['2', '3'])
  })

  it('builds Graph API parameters, positional or named', () => {
    expect(templateComponents(t, values)).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Sam' }, { type: 'text', text: '4' }, { type: 'text', text: 'Friday at 8pm' }] },
    ])
    const named = parseTemplate({ name: 'n', language: 'en', parameter_format: 'NAMED', components: [{ type: 'BODY', text: 'Hi {{name}}' }] })
    expect(templateComponents(named, { name: 'Ava' })).toEqual([
      { type: 'body', parameters: [{ type: 'text', parameter_name: 'name', text: 'Ava' }] },
    ])
    expect(templateComponents(parseTemplate({ name: 'h', language: 'en', components: [{ type: 'BODY', text: 'Hello' }] }), {})).toEqual([])
  })
})
