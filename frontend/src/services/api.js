const DEFAULT_SERVER_URL = 'http://localhost:8080';

/**
 * Get the configured Blossom server URL.
 */
export function getServerURL() {
  return localStorage.getItem('blossom_server_url') || DEFAULT_SERVER_URL;
}

/**
 * Set the Blossom server URL.
 */
export function setServerURL(url) {
  localStorage.setItem('blossom_server_url', url.replace(/\/$/, ''));
}

/**
 * Upload a blob to the Blossom server.
 * @param {File} file - The file to upload
 * @param {string} nip98Token - Base64-encoded NIP-98 auth event
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<object>} Upload response with url, sha256, size, type
 */
export async function uploadBlob(file, nip98Token, onProgress) {
  const serverURL = getServerURL();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${serverURL}/upload`, true);

    // Set headers
    xhr.setRequestHeader('Authorization', `Nostr ${nip98Token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', file.name || 'unnamed');

    // Progress tracking
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.timeout = 300000; // 5 minutes

    xhr.send(file);
  });
}

/**
 * Delete a blob from the server.
 */
export async function deleteBlob(sha256, nip98Token) {
  const serverURL = getServerURL();
  const res = await fetch(`${serverURL}/${sha256}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Nostr ${nip98Token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || 'Delete failed');
  }
  return res.json();
}

/**
 * List blobs for a pubkey.
 */
export async function listBlobs(pubkey, nip98Token) {
  const serverURL = getServerURL();
  const res = await fetch(`${serverURL}/list/${pubkey}`, {
    headers: { 'Authorization': `Nostr ${nip98Token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'List failed' }));
    throw new Error(err.error || 'List failed');
  }
  return res.json();
}

/**
 * Get the public URL of a blob.
 */
export function getBlobURL(sha256) {
  return `${getServerURL()}/${sha256}`;
}

/**
 * Check server health / info.
 */
export async function getServerInfo() {
  const serverURL = getServerURL();
  const res = await fetch(serverURL);
  if (!res.ok) throw new Error('Server unreachable');
  return res.json();
}
