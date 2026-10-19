import { encode } from 'blurhash'

export const THUMB_MAX_SIDE = 512

export interface PreparedMedia {
  width: number
  height: number
  /** Small preview, uploaded as its own blob. Absent if the browser cannot decode the file. */
  thumb?: Blob
  blurhash?: string
  durationSeconds?: number
  /** Why no thumbnail could be made, for display next to the file. */
  thumbWarning?: string
}

/**
 * Reads dimensions, makes a thumbnail and computes a BlurHash, all in the
 * browser. The original file is never re-encoded.
 */
export async function prepareMedia(file: File): Promise<PreparedMedia> {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name)
    ? prepareVideo(file)
    : prepareImage(file)
}

async function prepareImage(file: File): Promise<PreparedMedia> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return {
      width: 0,
      height: 0,
      thumbWarning: 'This browser could not decode the image, so no preview was made.',
    }
  }
  try {
    return {
      width: bitmap.width,
      height: bitmap.height,
      ...(await render(bitmap, bitmap.width, bitmap.height)),
    }
  } finally {
    bitmap.close()
  }
}

function prepareVideo(file: File): Promise<PreparedMedia> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  const fail = (warning: string): PreparedMedia => ({ width: 0, height: 0, thumbWarning: warning })
  const cleanup = () => {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }

  return new Promise<PreparedMedia>((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(fail('This browser could not read the video, so no preview was made.'))
    }, 20_000)

    video.onerror = () => {
      clearTimeout(timer)
      cleanup()
      resolve(fail('This browser does not support this video format, so no preview was made.'))
    }
    let captured = false
    const capture = async () => {
      if (captured) return
      captured = true
      clearTimeout(timer)
      const { videoWidth: w, videoHeight: h, duration } = video
      const seconds = Number.isFinite(duration) ? duration : undefined
      try {
        const bitmap = await createImageBitmap(video)
        const out = await render(bitmap, w, h)
        bitmap.close()
        resolve({ width: w, height: h, durationSeconds: seconds, ...out })
      } catch {
        resolve({
          width: w,
          height: h,
          durationSeconds: seconds,
          thumbWarning: 'The preview frame could not be captured.',
        })
      } finally {
        cleanup()
      }
    }
    // Files recorded in the browser often report an infinite duration and cannot be
    // seeked; their first decoded frame is used. Other files are sampled a little in.
    video.onloadeddata = () => {
      const d = video.duration
      if (Number.isFinite(d) && d > 0.3) video.currentTime = Math.min(1, d * 0.1)
      else void capture()
    }
    video.onseeked = () => void capture()
  })
}

type Source = ImageBitmap

async function render(bitmap: Source, width: number, height: number) {
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(width, height))
  const tw = Math.max(1, Math.round(width * scale))
  const th = Math.max(1, Math.round(height * scale))

  const thumbCanvas = makeCanvas(tw, th)
  const ctx = thumbCanvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, tw, th)

  // BlurHash needs a few hundred pixels, not the whole thumbnail.
  const bw = 32
  const bh = Math.max(1, Math.round((32 * height) / width))
  const small = makeCanvas(bw, bh)
  const sctx = small.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  sctx.drawImage(bitmap, 0, 0, bw, bh)
  const pixels = sctx.getImageData(0, 0, bw, bh)
  const blurhash = encode(pixels.data, bw, bh, 4, 3)

  const thumb = await toBlob(thumbCanvas)
  return { thumb, blurhash }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  const encodeAs = async (type: string, quality: number): Promise<Blob | null> =>
    'convertToBlob' in canvas
      ? canvas.convertToBlob({ type, quality })
      : new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, type, quality))

  // Browsers that cannot encode WebP silently return PNG; use JPEG then.
  const webp = await encodeAs('image/webp', 0.82)
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await encodeAs('image/jpeg', 0.82)
  if (!jpeg) throw new Error('Could not encode the preview image')
  return jpeg
}
