import type { MediaItem } from '../nostr/events'

export interface VaultStats {
  objects: number
  photos: number
  videos: number
  /** Bytes of originals whose size is known. */
  bytes: number
  photoBytes: number
  videoBytes: number
  /** Items whose event did not carry a size. */
  unsized: number
}

/** Totals shown above the library. Everything is summed from the metadata events. */
export function vaultStats(items: readonly MediaItem[]): VaultStats {
  const s: VaultStats = {
    objects: items.length,
    photos: 0,
    videos: 0,
    bytes: 0,
    photoBytes: 0,
    videoBytes: 0,
    unsized: 0,
  }
  for (const item of items) {
    const size = item.size ?? 0
    if (item.size === undefined) s.unsized++
    s.bytes += size
    if (item.kind === 'video') {
      s.videos++
      s.videoBytes += size
    } else {
      s.photos++
      s.photoBytes += size
    }
  }
  return s
}
