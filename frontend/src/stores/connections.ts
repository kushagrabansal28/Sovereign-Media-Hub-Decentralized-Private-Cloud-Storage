import { useSyncExternalStore } from 'react'
import { checkHealth, getServerInfo, type ServerInfo } from '../lib/blossom/client'
import { createStore } from './createStore'

export type ServerState = 'checking' | 'ok' | 'unreachable'

export interface ServerStatus {
  state: ServerState
  /** Round trip to /health in milliseconds. */
  ms?: number
  version?: string
  info?: ServerInfo
  error?: string
  checkedAt?: number
}

/** Default when the server has not described itself yet. */
export const DEFAULT_MAX_UPLOAD = 100 * 1024 * 1024

/**
 * Whether the storage server answers. Relay state lives in RelayManager; the
 * two are shown separately because they can fail independently.
 */
export class ServerConnection {
  readonly state = createStore<ServerStatus>({ state: 'checking' })
  private timer: ReturnType<typeof setInterval> | undefined
  private controller: AbortController | undefined

  constructor(private readonly url: () => string) {}

  async check(): Promise<ServerStatus> {
    this.controller?.abort()
    const controller = (this.controller = new AbortController())
    const timeout = setTimeout(() => controller.abort(), 6000)
    this.state.update((s) => ({ ...s, state: s.checkedAt ? s.state : 'checking' }))
    const url = this.url()
    try {
      const health = await checkHealth(url, controller.signal)
      const info = await getServerInfo(url, controller.signal).catch(() => undefined)
      const next: ServerStatus = {
        state: 'ok',
        ms: health.ms,
        version: health.version,
        info,
        checkedAt: Date.now(),
      }
      this.state.set(next)
      return next
    } catch (cause) {
      const next: ServerStatus = {
        state: 'unreachable',
        error:
          controller.signal.aborted && !(cause instanceof Error && cause.name === 'BlossomError')
            ? 'No answer within 6 seconds.'
            : cause instanceof Error
              ? cause.message
              : 'Could not reach the server.',
        checkedAt: Date.now(),
      }
      if (this.controller === controller) this.state.set(next)
      return next
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Re-checks every 60 s while the tab is visible, and when connectivity returns. */
  start() {
    this.stop()
    void this.check()
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.check()
    }, 60_000)
    window.addEventListener('online', this.onOnline)
    document.addEventListener('visibilitychange', this.onVisible)
  }

  stop() {
    clearInterval(this.timer)
    window.removeEventListener('online', this.onOnline)
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  private onOnline = () => void this.check()
  private onVisible = () => {
    const last = this.state.get().checkedAt ?? 0
    if (document.visibilityState === 'visible' && Date.now() - last > 15_000) void this.check()
  }

  maxUploadBytes(): number {
    return this.state.get().info?.max_upload_bytes ?? DEFAULT_MAX_UPLOAD
  }
}

export function useServerStatus(conn: ServerConnection): ServerStatus {
  return useSyncExternalStore(conn.state.subscribe, conn.state.get)
}
