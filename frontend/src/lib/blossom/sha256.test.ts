import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashFile } from './hash'
import { sha256Native, sha256Stream } from './sha256'

// SHA-256 of the ASCII text "abc".
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('SHA-256 without a secure context', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches the native digest when crypto.subtle is available', async () => {
    expect(await sha256Native(new Blob(['abc']))).toBe(ABC)
    expect(await sha256Stream(new Blob(['abc']))).toBe(ABC)
  })

  it('still hashes when crypto.subtle is missing (plain HTTP on a LAN)', async () => {
    vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: undefined })
    expect(globalThis.crypto.subtle).toBeUndefined()
    expect(await sha256Native(new Blob(['abc']))).toBe(ABC)
    expect(await hashFile(new Blob(['abc']))).toBe(ABC)
  })

  it('still hashes when crypto itself is missing', async () => {
    vi.stubGlobal('crypto', undefined)
    expect(await hashFile(new Blob(['abc']))).toBe(ABC)
  })
})
