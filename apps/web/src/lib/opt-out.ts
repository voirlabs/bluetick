// Exact-match keywords only. Matching on prefixes ("cancel my booking") would
// silently unsubscribe customers who are mid-conversation.
const OPT_OUT = new Set(['stop', 'unsubscribe', 'opt out', 'opt-out', 'optout', 'stop all'])
const OPT_IN = new Set(['start', 'unstop', 'subscribe'])

function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isOptOutMessage(text: string) {
  return OPT_OUT.has(normalise(text))
}

export function isOptInMessage(text: string) {
  return OPT_IN.has(normalise(text))
}
