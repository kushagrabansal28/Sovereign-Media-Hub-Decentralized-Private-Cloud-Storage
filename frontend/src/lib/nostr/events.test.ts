import { describe, expect, it } from 'vitest'
import {
  buildDeletionEvent,
  buildMediaEvent,
  deletedIds,
  KIND_FILE_METADATA,
  parseMediaEvent,
} from './events'
import { generateKey, publicKeyOf, signWithKey, type Event } from './keys'

const sk = generateKey()
const pk = publicKeyOf(sk)
const H = 'a'.repeat(64)
const T = 'b'.repeat(64)

function signed(tags: string[][], kind = KIND_FILE_METADATA, content = ''): Event {
  return signWithKey(sk, { kind, created_at: 1_700_000_000, tags, content })
}

const base = (): string[][] => [
  ['url', 'https://h/x.jpg'],
  ['m', 'image/jpeg'],
  ['x', H],
]

describe('media events', () => {
  it('builds a NIP-94 event that parses back to the same values', () => {
    const template = buildMediaEvent({
      url: 'https://media.example.org/' + H + '.jpg',
      sha256: H,
      mime: 'image/jpeg',
      size: 12345,
      width: 4000,
      height: 3000,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      thumb: { url: 'https://media.example.org/' + T + '.webp', sha256: T },
      alt: 'Harbour at dusk',
      caption: 'Trip',
      taken: 1_650_000_000,
      now: () => 1_700_000_000_000,
    })
    expect(template.kind).toBe(1063)
    expect(template.created_at).toBe(1_700_000_000)
    expect(template.tags.map((t) => t[0])).toEqual([
      'url',
      'm',
      'x',
      'ox',
      'size',
      'dim',
      'blurhash',
      'thumb',
      'alt',
      'smh-taken',
    ])

    const item = parseMediaEvent(signWithKey(sk, template))
    expect(item).toMatchObject({
      sha256: H,
      originalSha256: H,
      mime: 'image/jpeg',
      kind: 'image',
      size: 12345,
      width: 4000,
      height: 3000,
      thumbUrl: 'https://media.example.org/' + T + '.webp',
      thumbSha256: T,
      alt: 'Harbour at dusk',
      caption: 'Trip',
      taken: 1_650_000_000,
      pubkey: pk,
    })
  })

  it('identifies videos', () => {
    const item = parseMediaEvent(
      signed([
        ['url', 'https://h/x.mp4'],
        ['m', 'video/mp4'],
        ['x', H],
      ]),
    )
    expect(item?.kind).toBe('video')
  })

  it.each([
    ['missing url', base().filter((t) => t[0] !== 'url')],
    ['missing hash', base().filter((t) => t[0] !== 'x')],
    ['missing mime', base().filter((t) => t[0] !== 'm')],
    ['short hash', base().map((t) => (t[0] === 'x' ? ['x', 'abc'] : t))],
    ['uppercase hash', base().map((t) => (t[0] === 'x' ? ['x', 'A'.repeat(64)] : t))],
    ['javascript url', base().map((t) => (t[0] === 'url' ? ['url', 'javascript:alert(1)'] : t))],
    ['data url', base().map((t) => (t[0] === 'url' ? ['url', 'data:text/html,hi'] : t))],
    ['non-media mime', base().map((t) => (t[0] === 'm' ? ['m', 'text/html'] : t))],
  ])('rejects an event with %s', (_name, tags) => {
    expect(parseMediaEvent(signed(tags))).toBeNull()
  })

  it('ignores malformed optional tags instead of failing the whole event', () => {
    const item = parseMediaEvent(
      signed([
        ...base(),
        ['dim', '0x0'],
        ['dim', '99999999x1'],
        ['size', '-5'],
        ['blurhash', '<script>'],
        ['thumb', 'javascript:alert(1)'],
        ['smh-taken', 'yesterday'],
      ]),
    )
    expect(item).not.toBeNull()
    expect(item).not.toHaveProperty('width')
    expect(item).not.toHaveProperty('size')
    expect(item).not.toHaveProperty('blurhash')
    expect(item).not.toHaveProperty('thumbUrl')
    expect(item).not.toHaveProperty('taken')
  })

  it('does not parse other kinds', () => {
    expect(parseMediaEvent(signed(base(), 1))).toBeNull()
  })

  it('tolerates tags that are too short', () => {
    expect(parseMediaEvent(signed([...base(), ['dim'], ['thumb']]))).not.toBeNull()
  })
})

describe('deletion events', () => {
  it('references the event ids and kind (NIP-09)', () => {
    const id = 'c'.repeat(64)
    const t = buildDeletionEvent([id], () => 1_700_000_000_000)
    expect(t.kind).toBe(5)
    expect(t.tags).toEqual([
      ['e', id],
      ['k', '1063'],
    ])
  })

  it('only honours deletions signed by the library owner', () => {
    const id = 'c'.repeat(64)
    const mine = signWithKey(sk, buildDeletionEvent([id]))
    const theirs = signWithKey(generateKey(), buildDeletionEvent([id]))
    expect(deletedIds(mine, pk)).toEqual([id])
    expect(deletedIds(theirs, pk)).toEqual([])
  })
})
