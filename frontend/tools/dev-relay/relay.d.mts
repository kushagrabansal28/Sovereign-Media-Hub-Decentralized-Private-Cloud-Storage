import type { Event } from 'nostr-tools/pure'

export interface DevRelay {
  url: string
  port: number
  events: Map<string, Event>
  rejectWrites(reason: string | null): void
  setDelay(ms: number): void
  dropConnections(): void
  close(): Promise<void>
}

export function startRelay(options?: {
  port?: number
  persist?: string
  maxLimit?: number
  host?: string
}): Promise<DevRelay>
