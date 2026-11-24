import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchPageText, htmlToText, isPublicAddress } from './fetch-page'

describe('isPublicAddress', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd00:ec2::254',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::a9fe:a9fe',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('allows public addresses', () => {
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(ip), ip).toBe(true)
    }
  })
})

describe('htmlToText', () => {
  it('drops scripts, styles and tags and decodes entities', () => {
    expect(
      htmlToText(
        '<html><style>p{}</style><script>alert(1)</script><p>Fish &amp; chips&nbsp;&#163;9 &#x2014; <b>daily</b></p><!-- x --></html>'
      )
    ).toBe('Fish & chips £9 — daily')
  })
})

describe('fetchPageText', () => {
  let server: http.Server
  let base: string
  // Lets the test server on 127.0.0.1 stand in for a public host.
  const allowLocal = (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip)

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/page') {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end('<h1>Opening hours</h1><p>Tue&ndash;Sun</p>')
      } else if (req.url === '/gzip') {
        res.setHeader('content-type', 'text/plain')
        res.setHeader('content-encoding', 'gzip')
        res.end(gzipSync('Compressed text'))
      } else if (req.url === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end()
      } else if (req.url === '/to-lan') {
        res.writeHead(301, { location: 'http://192.168.0.1/admin' }).end()
      } else if (req.url === '/to-file') {
        res.writeHead(302, { location: 'file:///etc/passwd' }).end()
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' }).end()
      } else if (req.url === '/pdf') {
        res.setHeader('content-type', 'application/pdf')
        res.end('%PDF-1.4')
      } else if (req.url === '/big') {
        res.setHeader('content-type', 'text/plain')
        res.end('x'.repeat(6 * 1024 * 1024))
      } else {
        res.writeHead(404).end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('returns the text of a page and decompresses it', async () => {
    await expect(fetchPageText(`${base}/page`, allowLocal)).resolves.toBe('Opening hours Tue–Sun')
    await expect(fetchPageText(`${base}/gzip`, allowLocal)).resolves.toBe('Compressed text')
  })

  it('refuses loopback addresses and hostnames that resolve to them', async () => {
    await expect(fetchPageText(`${base}/page`)).rejects.toThrow(/private or internal/)
    const port = (server.address() as AddressInfo).port
    await expect(fetchPageText(`http://localhost:${port}/page`)).rejects.toThrow(
      /private or internal/
    )
    await expect(fetchPageText('http://[::1]/')).rejects.toThrow(/private or internal/)
  })

  it('re-checks every redirect', async () => {
    await expect(fetchPageText(`${base}/to-metadata`, allowLocal)).rejects.toThrow(
      /private or internal/
    )
    await expect(fetchPageText(`${base}/to-lan`, allowLocal)).rejects.toThrow(/private or internal/)
    await expect(fetchPageText(`${base}/to-file`, allowLocal)).rejects.toThrow(/http and https/)
    await expect(fetchPageText(`${base}/loop`, allowLocal)).rejects.toThrow(/too many times/)
  })

  it('rejects non-text pages, oversized pages and HTTP errors', async () => {
    await expect(fetchPageText(`${base}/pdf`, allowLocal)).rejects.toThrow(/application\/pdf/)
    await expect(fetchPageText(`${base}/big`, allowLocal)).rejects.toThrow(/larger than 5 MB/)
    await expect(fetchPageText(`${base}/missing`, allowLocal)).rejects.toThrow(/HTTP 404/)
  })
})
