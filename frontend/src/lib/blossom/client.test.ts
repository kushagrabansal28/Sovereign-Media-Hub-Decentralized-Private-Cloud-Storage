import { describe, expect, it } from 'vitest'
import { authorization, base64url, blobUrl, normalizeServerUrl } from './client'
import { generateKey, signWithKey, verifyEvent, type Event } from '../nostr/keys'

const sk = generateKey()
const sign = async (t: Parameters<typeof signWithKey>[1]) => signWithKey(sk, t)
const H = 'a'.repeat(64)

function decode(header: string): Event {
  const [scheme, payload] = header.split(' ')
  expect(scheme).toBe('Nostr')
  expect(payload).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no padding
  const binary = atob(payload!.replace(/-/g, '+').replace(/_/g, '/'))
  const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
  return JSON.parse(json) as Event
}

describe('Blossom authorization (BUD-11)', () => {
  it('is a signed kind 24242 event with verb, hashes, expiration and server', async () => {
    const now = 1_800_000_000_000
    const ev = decode(
      await authorization(sign, {
        verb: 'upload',
        serverUrl: 'https://Media.Example.org',
        hashes: [H],
        content: 'Upload photo',
        ttlSeconds: 120,
        now: () => now,
      }),
    )
    expect(ev.kind).toBe(24242)
    expect(verifyEvent(ev)).toBe(true)
    expect(ev.created_at).toBeLessThan(now / 1000)
    expect(ev.tags).toContainEqual(['t', 'upload'])
    expect(ev.tags).toContainEqual(['x', H])
    expect(ev.tags).toContainEqual(['expiration', String(now / 1000 + 120)])
    expect(ev.tags).toContainEqual(['server', 'media.example.org'])
    expect(ev.content).toBe('Upload photo')
  })

  it('does not use the NIP-98 kind or tags', async () => {
    const ev = decode(
      await authorization(sign, {
        verb: 'list',
        serverUrl: 'http://localhost:8080',
        content: 'List',
      }),
    )
    expect(ev.kind).not.toBe(27235)
    expect(ev.tags.some((t) => t[0] === 'u' || t[0] === 'method')).toBe(false)
  })

  it('handles non-Latin-1 content', async () => {
    const ev = decode(
      await authorization(sign, {
        verb: 'get',
        serverUrl: 'http://localhost:8080',
        content: 'Foto: Zürich ☃',
      }),
    )
    expect(ev.content).toBe('Foto: Zürich ☃')
  })

  it('base64url has no padding or unsafe characters', () => {
    expect(base64url('???>>>')).toBe('Pz8_Pj4-')
  })
})

describe('server URLs', () => {
  it('normalises origins', () => {
    expect(normalizeServerUrl(' https://media.example.org/ ')).toBe('https://media.example.org')
    expect(normalizeServerUrl('http://localhost:8080')).toBe('http://localhost:8080')
  })

  it.each(['', 'media.example.org', 'ftp://x.org', 'https://x.org/blobs', 'https://x.org/?a=1'])(
    'rejects %j',
    (v) => {
      expect(() => normalizeServerUrl(v)).toThrow()
    },
  )

  it('builds blob URLs with the right extension', () => {
    expect(blobUrl('https://h', H, 'video/mp4')).toBe(`https://h/${H}.mp4`)
    expect(blobUrl('https://h', H)).toBe(`https://h/${H}`)
  })
})
