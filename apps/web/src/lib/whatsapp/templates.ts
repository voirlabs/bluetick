/**
 * Approved WhatsApp templates: the only messages allowed once a customer's
 * 24-hour window has closed. This reads Meta's template definitions and fills
 * in body variables. Pure, so it's tested without the Graph API.
 *
 * Only templates a small form can fill are offered: text-only headers without
 * variables, body variables (numbered {{1}} or named {{first_name}}), and
 * buttons that need no input. The rest are listed with the reason.
 */

/** A template as the Graph API returns it (only the fields we read). */
export interface RawTemplate {
  name: string
  language: string
  status?: string
  category?: string
  parameter_format?: string
  components?: Array<{
    type: string
    format?: string
    text?: string
    buttons?: Array<{ type: string; text?: string; url?: string }>
  }>
}

export interface Template {
  name: string
  language: string
  category: string
  /** Header and body as the customer sees them, with {{...}} placeholders. */
  preview: string
  /** Body variables in order: "1", "2" or names like "first_name". */
  variables: string[]
  named: boolean
  /** Why it can't be sent from the inbox, or null when it can. */
  unsupported: string | null
}

const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

function variablesIn(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map((m) => m[1]!))]
}

export function parseTemplate(raw: RawTemplate): Template {
  const components = raw.components ?? []
  const header = components.find((c) => c.type.toUpperCase() === 'HEADER')
  const body = components.find((c) => c.type.toUpperCase() === 'BODY')
  const buttons = components.find((c) => c.type.toUpperCase() === 'BUTTONS')?.buttons ?? []
  const bodyText = body?.text ?? ''

  let unsupported: string | null = null
  if ((raw.category ?? '').toUpperCase() === 'AUTHENTICATION') {
    unsupported = 'Authentication templates send one-time codes; they are not for conversations.'
  } else if (header && (header.format ?? 'TEXT').toUpperCase() !== 'TEXT') {
    unsupported = `It has a ${(header.format ?? '').toLowerCase()} header, which can't be added here.`
  } else if (header?.text && variablesIn(header.text).length) {
    unsupported = 'Its header has a variable, which can\'t be filled in here.'
  } else if (buttons.some((b) => b.url && variablesIn(b.url).length)) {
    unsupported = 'One of its buttons has a link variable, which can\'t be filled in here.'
  } else if (buttons.some((b) => !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(b.type.toUpperCase()))) {
    unsupported = 'It has a button type that needs extra input.'
  } else if (!bodyText) {
    unsupported = 'It has no body text.'
  }

  return {
    name: raw.name,
    language: raw.language,
    category: (raw.category ?? '').toLowerCase(),
    preview: [header?.text, bodyText].filter(Boolean).join('\n\n'),
    variables: variablesIn(bodyText),
    named: (raw.parameter_format ?? '').toUpperCase() === 'NAMED',
    unsupported,
  }
}

/** The text the customer receives, for the inbox and the preview. */
export function renderTemplate(t: Template, values: Record<string, string>): string {
  return t.preview.replace(VAR, (whole, key: string) => values[key]?.trim() || whole)
}

/** Which variables are still empty. */
export function missingValues(t: Template, values: Record<string, string>): string[] {
  return t.variables.filter((v) => !values[v]?.trim())
}

/** The `components` the Graph API needs to send the template with these values. */
export function templateComponents(t: Template, values: Record<string, string>) {
  if (t.variables.length === 0) return []
  return [
    {
      type: 'body',
      parameters: t.variables.map((v) =>
        t.named
          ? { type: 'text', parameter_name: v, text: values[v]!.trim() }
          : { type: 'text', text: values[v]!.trim() }
      ),
    },
  ]
}
