/**
 * Client-side mirror of the server's file-type check. The server is the
 * authority; this exists so the user hears about a bad file before uploading it.
 */
export type DetectedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/avif'
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm'

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to))

export function sniff(head: Uint8Array): DetectedType | null {
  const eq = (...bytes: number[]) => bytes.every((v, i) => head[i] === v)
  if (eq(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (eq(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'image/gif'
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP')
    return 'image/webp'
  if (eq(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm'
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'qt  ') return 'video/quicktime'
    if (
      ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(
        brand,
      )
    ) {
      return 'video/mp4'
    }
  }
  return null
}

export type Validation = { ok: true; mime: DetectedType } | { ok: false; reason: string }

export async function validateFile(file: File, maxBytes: number): Promise<Validation> {
  if (file.size === 0) return { ok: false, reason: 'The file is empty.' }
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `The file is larger than the server limit of ${formatLimit(maxBytes)}.`,
    }
  }
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const mime = sniff(head)
  if (!mime) {
    return {
      ok: false,
      reason: 'Only JPEG, PNG, GIF, WebP, AVIF, MP4, MOV and WebM files can be uploaded.',
    }
  }
  return { ok: true, mime }
}

function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
