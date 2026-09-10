import imageCompression from 'browser-image-compression';

/**
 * Compress an image file before uploading.
 * Targets a max size of 1MB and max dimension of 1920px.
 */
export async function compressImage(file, onProgress) {
  // Skip compression for non-image files or already small files
  if (!file.type.startsWith('image/') || file.size < 100 * 1024) {
    return file;
  }

  // Skip compression for GIFs (lossy compression ruins them)
  if (file.type === 'image/gif') {
    return file;
  }

  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/webp', // Convert to WebP for better compression
    onProgress: (progress) => {
      if (onProgress) onProgress(progress);
    },
  };

  try {
    const compressedFile = await imageCompression(file, options);
    console.log(
      `Compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB ` +
      `(${((1 - compressedFile.size / file.size) * 100).toFixed(0)}% reduction)`
    );
    return compressedFile;
  } catch (error) {
    console.warn('Compression failed, using original file:', error);
    return file;
  }
}

/**
 * Check if a file is a supported media type.
 */
export function isSupportedMedia(file) {
  const supportedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'image/gif', 'image/svg+xml', 'image/avif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  ];
  return supportedTypes.includes(file.type);
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
