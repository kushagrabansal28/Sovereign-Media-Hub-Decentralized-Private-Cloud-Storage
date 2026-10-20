import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../nostr/events'
import { vaultStats } from './stats'

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: 'e',
  pubkey: 'p',
  createdAt: 1,
  url: 'http://x/y',
  sha256: 'a'.repeat(64),
  originalSha256: 'a'.repeat(64),
  mime: 'image/png',
  kind: 'image',
  caption: '',
  ...over,
})

describe('vaultStats', () => {
  it('is all zero for an empty library', () => {
    expect(vaultStats([])).toEqual({
      objects: 0,
      photos: 0,
      videos: 0,
      bytes: 0,
      photoBytes: 0,
      videoBytes: 0,
      unsized: 0,
    })
  })

  it('splits photos and videos and sums bytes', () => {
    const s = vaultStats([
      item({ size: 1000 }),
      item({ size: 500 }),
      item({ kind: 'video', mime: 'video/webm', size: 4000 }),
    ])
    expect(s).toMatchObject({
      objects: 3,
      photos: 2,
      videos: 1,
      bytes: 5500,
      photoBytes: 1500,
      videoBytes: 4000,
    })
  })

  it('counts items without a size instead of guessing one', () => {
    const s = vaultStats([item({ size: 10 }), item({})])
    expect(s.bytes).toBe(10)
    expect(s.unsized).toBe(1)
  })
})
