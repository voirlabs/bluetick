import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { Readable } from 'node:stream'
import zlib from 'node:zlib'

const MAX_PAGE_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 15_000
const TEXT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown']

// Addresses a knowledge-base URL must never reach: private networks, loopback,
// link-local (including cloud metadata at 169.254.169.254), and ranges that
// embed or translate to IPv4 addresses. BlockList checks IPv4-mapped IPv6
// addresses (::ffff:a.b.c.d) against the IPv4 rules.
const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 127], // unspecified and loopback
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local, including AWS metadata fd00:ec2::254
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6')
}

/** True for addresses on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 0) return false
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

class PageFetchError extends Error {
  override name = 'PageFetchError'
}

const BLOCKED_MESSAGE = 'That address is on a private or internal network'

type Allow = (ip: string) => boolean

/** DNS lookup that refuses to connect if any resolved address is not allowed. */
function guardedLookup(allow: Allow) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void
  ) => {
    dnsLookup(hostname, { family: options.family ?? 0, all: true }, (err, addresses) => {
      if (err) return callback(err, '')
      const first = addresses[0]
      if (!first || addresses.some((a) => !allow(a.address))) {
        return callback(new PageFetchError(BLOCKED_MESSAGE), '')
      }
      if (options.all) callback(null, addresses)
      else callback(null, first.address, first.family)
    })
  }
}

function get(url: URL, allow: Allow, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'BluetickIndexer/1.0',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        lookup: guardedLookup(allow) as unknown as typeof dnsLookup,
        signal,
      },
      resolve
    )
    req.on('error', reject)
  })
}

async function readBody(res: http.IncomingMessage): Promise<string> {
  const encoding = (res.headers['content-encoding'] ?? '').toLowerCase()
  let stream: Readable = res
  if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip())
  else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate())
  else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress())

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    size += (chunk as Buffer).length
    if (size > MAX_PAGE_BYTES) {
      res.destroy()
      throw new PageFetchError('The page is larger than 5 MB')
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
}

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match
    const n =
      code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match
  })
}

/** Visible text of an HTML document. */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetches a public web page and returns its text. Refuses private, loopback,
 * link-local and metadata addresses, after DNS resolution and on every
 * redirect, so a knowledge-base URL can't be used to read internal services.
 * `allow` is for tests.
 */
export async function fetchPageText(
  rawUrl: string,
  allow: Allow = isPublicAddress
): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let url = new URL(rawUrl)

  for (let redirects = 0; ; redirects++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new PageFetchError('Only http and https pages can be added')
    }
    if (url.username || url.password)
      throw new PageFetchError('Remove the credentials from the URL')
    // Node skips the DNS lookup for IP literals, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !allow(host)) throw new PageFetchError(BLOCKED_MESSAGE)

    const res = await get(url, allow, signal).catch((err: unknown) => {
      if (err instanceof PageFetchError) throw err
      if (signal.aborted) throw new PageFetchError('The page took too long to respond')
      throw new PageFetchError(
        `Could not reach the page${err instanceof Error ? `: ${err.message}` : ''}`
      )
    })
    const status = res.statusCode ?? 0

    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      if (redirects >= MAX_REDIRECTS) throw new PageFetchError('The page redirects too many times')
      url = new URL(res.headers.location, url)
      continue
    }
    if (status < 200 || status >= 300) {
      res.resume()
      throw new PageFetchError(`The page returned HTTP ${status}`)
    }

    const type = (res.headers['content-type'] ?? 'text/html').split(';')[0]!.trim().toLowerCase()
    if (!TEXT_TYPES.includes(type)) {
      res.resume()
      throw new PageFetchError(
        `The page is ${type}, not HTML or text. Upload files under Document instead.`
      )
    }
    if (Number(res.headers['content-length'] ?? 0) > MAX_PAGE_BYTES) {
      res.resume()
      throw new PageFetchError('The page is larger than 5 MB')
    }

    const body = await readBody(res)
    return type === 'text/plain' || type === 'text/markdown' ? body.trim() : htmlToText(body)
  }
}
