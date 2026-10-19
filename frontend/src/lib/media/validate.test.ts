import { describe, expect, it } from 'vitest'
import { sniff, validateFile } from './validate'

const bytes = (...v: number[]) => new Uint8Array([...v, ...new Array(32).fill(0)])
const text = (s: string) =>
  new Uint8Array([...new TextEncoder().encode(s), ...new Array(32).fill(0)])
const file = (data: Uint8Array, name = 'x.bin') => new File([data as BlobPart], name)

describe('sniff', () => {
  it.each([
    ['jpeg', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['gif', text('GIF89a'), 'image/gif'],
    ['webp', text('RIFF\0\0\0\0WEBP'), 'image/webp'],
    ['webm', bytes(0x1a, 0x45, 0xdf, 0xa3), 'video/webm'],
    ['mp4', text('\0\0\0\x18ftypisom'), 'video/mp4'],
    ['mov', text('\0\0\0\x14ftypqt  '), 'video/quicktime'],
    ['avif', text('\0\0\0\x1cftypavif'), 'image/avif'],
  ])('recognises %s', (_n, data, expected) => {
    expect(sniff(data)).toBe(expected)
  })

  it.each([
    ['html', text('<!doctype html>')],
    ['svg', text('<svg xmlns=')],
    ['wav', text('RIFF\0\0\0\0WAVE')],
    ['heic', text('\0\0\0\x18ftypheic')],
    ['text', text('hello')],
    ['empty', new Uint8Array()],
  ])('does not accept %s', (_n, data) => {
    expect(sniff(data)).toBeNull()
  })
})

describe('validateFile', () => {
  it('accepts a JPEG regardless of its extension', async () => {
    const r = await validateFile(file(bytes(0xff, 0xd8, 0xff), 'photo.txt'), 1000)
    expect(r).toEqual({ ok: true, mime: 'image/jpeg' })
  })

  it('rejects an HTML file renamed to .jpg', async () => {
    const r = await validateFile(file(text('<html>'), 'evil.jpg'), 1000)
    expect(r.ok).toBe(false)
  })

  it('rejects empty and oversized files with a reason', async () => {
    expect(await validateFile(new File([], 'a.jpg'), 1000)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/empty/),
    })
    const big = await validateFile(file(bytes(0xff, 0xd8, 0xff)), 10)
    expect(big).toMatchObject({ ok: false, reason: expect.stringMatching(/limit/) })
  })
})
