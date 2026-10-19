import { decode } from 'blurhash'

const MAX_ENTRIES = 600
const cache = new Map<string, string>()

/**
 * Turns a BlurHash into a small data URL for use as a background while the
 * thumbnail loads. Results are cached with a fixed cap so scrolling through a
 * large library cannot grow memory without bound.
 */
export function blurhashToDataUrl(hash: string): string | undefined {
  const hit = cache.get(hash)
  if (hit) {
    cache.delete(hash)
    cache.set(hash, hit)
    return hit
  }
  try {
    const w = 24
    const h = 24
    const pixels = decode(hash, w, h)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const image = ctx.createImageData(w, h)
    image.data.set(pixels)
    ctx.putImageData(image, 0, 0)
    const url = canvas.toDataURL()
    cache.set(hash, url)
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
    return url
  } catch {
    return undefined
  }
}
