const SIDE = 160

/**
 * Turns a chosen picture into a small square JPEG data URL for the profile. The picture is cropped
 * to the centre and scaled in the browser; the original file is not kept.
 */
export async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is larger than 15 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This browser could not read that image.')
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = SIDE
    canvas.height = SIDE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser could not prepare the picture.')
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIDE,
      SIDE,
    )
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    bitmap.close()
  }
}
