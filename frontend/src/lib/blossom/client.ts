import type { EventTemplate, VerifiedEvent } from '../nostr/keys'

export type Signer = (template: EventTemplate) => Promise<VerifiedEvent>

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type: string
  uploaded: number
}

export interface UploadResult extends BlobDescriptor {
  /** True when the server already held these bytes (HTTP 200 rather than 201). */
  existed: boolean
}

export interface ServerInfo {
  name: string
  software: string
  version: string
  buds: number[]
  max_upload_bytes: number
  allowed_types: string[]
  upload_policy: 'open' | 'allowlist'
}

export class BlossomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when repeating the same request could succeed. */
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'BlossomError'
  }
}

/** Returns an http(s) origin without a trailing slash, or throws. */
export function normalizeServerUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a full address such as https://media.example.org')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The storage server address must start with http:// or https://')
  }
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Use the server root, without a path or query.')
  }
  return url.origin
}

export function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type Verb = 'get' | 'upload' | 'list' | 'delete'

export interface TokenOptions {
  verb: Verb
  serverUrl: string
  hashes?: string[]
  content: string
  ttlSeconds?: number
  now?: () => number
}

/**
 * Creates a Blossom (BUD-11) authorization header value: a kind 24242 event
 * with a verb, the blob hashes it covers, an expiration, and the server it is
 * meant for. The token is signed locally; the key never leaves the client.
 */
export async function authorization(sign: Signer, opts: TokenOptions): Promise<string> {
  const now = Math.floor((opts.now?.() ?? Date.now()) / 1000)
  const tags: string[][] = [
    ['t', opts.verb],
    ['expiration', String(now + (opts.ttlSeconds ?? 300))],
    ['server', new URL(opts.serverUrl).hostname.toLowerCase()],
  ]
  for (const hash of opts.hashes ?? []) tags.push(['x', hash])
  const event = await sign({ kind: 24242, created_at: now - 5, tags, content: opts.content })
  return `Nostr ${base64url(JSON.stringify(event))}`
}

async function failure(res: Response, fallback: string): Promise<BlossomError> {
  const reason = res.headers.get('X-Reason') || (await res.text().catch(() => '')).slice(0, 200)
  const message = reason ? readableReason(res.status, reason) : fallback
  return new BlossomError(
    message,
    res.status,
    res.status >= 500 || res.status === 429 || res.status === 408,
  )
}

function readableReason(status: number, reason: string): string {
  try {
    const parsed = JSON.parse(reason) as { error?: string }
    if (parsed.error) return parsed.error
  } catch {
    /* plain text reason */
  }
  return reason || `Server answered ${status}`
}

async function request(url: string, init: RequestInit, fallback: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (cause) {
    if (init.signal?.aborted) throw cause
    throw new BlossomError(
      'Could not reach the storage server. Check the address, that the server is running, and that it allows this site (CORS).',
      0,
      true,
    )
  }
  if (!res.ok) throw await failure(res, fallback)
  return res
}

export async function getServerInfo(serverUrl: string, signal?: AbortSignal): Promise<ServerInfo> {
  const res = await request(
    `${serverUrl}/info`,
    { signal },
    'The server did not return its description.',
  )
  return (await res.json()) as ServerInfo
}

/** Measures one round trip to /health. */
export async function checkHealth(
  serverUrl: string,
  signal?: AbortSignal,
): Promise<{ ok: true; ms: number; version: string }> {
  const started = performance.now()
  const res = await request(
    `${serverUrl}/health`,
    { signal, cache: 'no-store' },
    'Health check failed.',
  )
  const body = (await res.json()) as { version?: string }
  return { ok: true, ms: Math.round(performance.now() - started), version: body.version ?? '' }
}

export async function blobExists(serverUrl: string, sha256: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/${sha256}`, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

export interface UploadOptions {
  serverUrl: string
  body: Blob
  sha256: string
  authorization: string
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Sends the bytes with PUT /upload. XMLHttpRequest is used where available
 * because fetch cannot report upload progress.
 */
export function uploadBlob(opts: UploadOptions): Promise<UploadResult> {
  const { serverUrl, body, sha256, signal } = opts
  const headers: Record<string, string> = {
    Authorization: opts.authorization,
    'X-SHA-256': sha256,
    'Content-Type': body.type || 'application/octet-stream',
  }

  if (typeof XMLHttpRequest === 'undefined') {
    return request(
      `${serverUrl}/upload`,
      { method: 'PUT', headers, body, signal },
      'Upload failed.',
    ).then(async (res) => ({
      ...((await res.json()) as BlobDescriptor),
      existed: res.status === 200,
    }))
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${serverUrl}/upload`)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)

    let sentAny = false
    xhr.upload.onprogress = (e) => {
      if (e.loaded > 0) sentAny = true
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      const reason = xhr.getResponseHeader('X-Reason') ?? ''
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          resolve({
            ...(JSON.parse(xhr.responseText) as BlobDescriptor),
            existed: xhr.status === 200,
          })
        } catch {
          reject(
            new BlossomError(
              'The server answered with something that is not a blob descriptor.',
              xhr.status,
              false,
            ),
          )
        }
        return
      }
      const message = readableReason(xhr.status, reason || xhr.responseText.slice(0, 200))
      reject(new BlossomError(message, xhr.status, xhr.status >= 500 || xhr.status === 429))
    }
    xhr.onerror = () =>
      reject(
        new BlossomError(
          sentAny
            ? 'The connection to the storage server was lost during the upload. The file is not stored until a retry completes.'
            : 'Could not reach the storage server. Check the address, that the server is running, and that it allows this site (CORS).',
          0,
          true,
        ),
      )
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    if (signal?.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'))
    xhr.send(body)
  })
}

export async function deleteBlob(
  serverUrl: string,
  sha256: string,
  authorizationValue: string,
): Promise<{ file_removed: boolean; owners_remaining: number }> {
  const res = await request(
    `${serverUrl}/${sha256}`,
    { method: 'DELETE', headers: { Authorization: authorizationValue } },
    'Delete failed.',
  )
  return (await res.json()) as { file_removed: boolean; owners_remaining: number }
}

export async function listBlobs(
  serverUrl: string,
  pubkey: string,
  authorizationValue: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<BlobDescriptor[]> {
  const q = new URLSearchParams()
  if (params.cursor) q.set('cursor', params.cursor)
  if (params.limit) q.set('limit', String(params.limit))
  const suffix = q.size ? `?${q}` : ''
  const res = await request(
    `${serverUrl}/list/${pubkey}${suffix}`,
    { headers: { Authorization: authorizationValue } },
    'Could not list blobs.',
  )
  return (await res.json()) as BlobDescriptor[]
}

/** Lists every blob the key owns by following cursors. */
export async function listAllBlobs(
  serverUrl: string,
  pubkey: string,
  sign: Signer,
  maxItems = 50_000,
): Promise<BlobDescriptor[]> {
  const all: BlobDescriptor[] = []
  let cursor: string | undefined
  while (all.length < maxItems) {
    const token = await authorization(sign, { verb: 'list', serverUrl, content: 'List blobs' })
    const page = await listBlobs(serverUrl, pubkey, token, { cursor, limit: 1000 })
    all.push(...page)
    const last = page[page.length - 1]
    if (page.length < 1000 || !last) break
    cursor = last.sha256
  }
  return all
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}

export function extensionFor(mime: string): string {
  return EXT[mime] ?? ''
}

/** URL of a blob on a given server, derived from its hash. */
export function blobUrl(serverUrl: string, sha256: string, mime?: string): string {
  const ext = mime ? extensionFor(mime) : ''
  return `${serverUrl}/${sha256}${ext ? `.${ext}` : ''}`
}

export const ACCEPTED_TYPES = Object.keys(EXT)
