import { crc32, deflateSync } from 'node:zlib'

/**
 * Encodes a small RGB PNG. Used by tests, benchmarks and the end-to-end suite to
 * make real, decodable images without bundling binary fixtures.
 *
 * `seed` changes the picture so different seeds give different bytes. `noise`
 * adds pseudo-random detail, which makes the file larger and less compressible.
 */
export function makePng(seed: number, size = 64, noise = 0): Uint8Array {
  const row = size * 3 + 1
  const raw = Buffer.alloc(row * size)
  let state = (seed * 2654435761) >>> 0 || 1
  const rand = () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state & 0xff
  }
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * row + 1 + x * 3
      raw[o] = (x * 255) / size + seed
      raw[o + 1] = (y * 255) / size + seed * 3
      raw[o + 2] = ((x + y) * 255) / (2 * size) + seed * 7
      if (noise) {
        raw[o] = raw[o]! ^ (rand() % noise)
        raw[o + 1] = raw[o + 1]! ^ (rand() % noise)
        raw[o + 2] = raw[o + 2]! ^ (rand() % noise)
      }
    }
  }

  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}
