import { encode } from 'blurhash';

/**
 * Generate a blurhash string from an image File.
 * Draws the image to a hidden canvas, reads pixel data, and encodes.
 */
export async function generateBlurhash(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Use a small canvas for performance (32x32 is plenty for blurhash)
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);
        const hash = encode(imageData.data, imageData.width, imageData.height, 4, 3);
        URL.revokeObjectURL(img.src);
        resolve(hash);
      } catch (err) {
        URL.revokeObjectURL(img.src);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image for blurhash'));
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Decode a blurhash string to a data URL suitable for CSS backgrounds.
 */
export function decodeBlurhashToDataURL(hash, width = 32, height = 32) {
  try {
    const { decode } = require('blurhash');
    const pixels = decode(hash, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

/**
 * Render a blurhash to a canvas element.
 */
export function renderBlurhashToCanvas(canvas, hash, width = 32, height = 32) {
  import('blurhash').then(({ decode }) => {
    const pixels = decode(hash, width, height);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
  });
}

/**
 * Get image dimensions from a File.
 */
export function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}
