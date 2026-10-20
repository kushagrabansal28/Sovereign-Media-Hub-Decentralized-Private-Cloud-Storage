// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_NAME, __resetProfilesForTests, cleanName, profiles } from './profile'

const KEY = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const PICTURE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

beforeEach(() => __resetProfilesForTests())

describe('cleanName', () => {
  it('trims, collapses spaces and removes control characters', () => {
    expect(cleanName('  Kushagra \t  Bansal\n')).toBe('Kushagra Bansal')
  })

  it('caps the length', () => {
    expect(cleanName('x'.repeat(200))).toHaveLength(MAX_NAME)
  })

  it('is empty for blank input', () => {
    expect(cleanName(' \n\t ')).toBe('')
  })
})

describe('profiles', () => {
  it('stores a name and picture per public key', () => {
    expect(profiles.set(KEY, { name: 'Kushagra Bansal', picture: PICTURE })).toBe(true)
    expect(profiles.get(KEY)).toEqual({ name: 'Kushagra Bansal', picture: PICTURE })
    expect(profiles.get(OTHER)).toBeUndefined()
  })

  it('refuses an empty name', () => {
    expect(profiles.set(KEY, { name: '   ' })).toBe(false)
    expect(profiles.get(KEY)).toBeUndefined()
  })

  it('drops a picture that is not a small JPEG data URL when loading', async () => {
    localStorage.setItem(
      'smh.profiles.v1',
      JSON.stringify({
        [KEY]: { name: 'Ok', picture: 'https://example.org/x.png' },
        'not-a-key': { name: 'Bad' },
      }),
    )
    vi.resetModules()
    const fresh = await import('./profile')
    expect(fresh.profiles.get(KEY)).toEqual({ name: 'Ok' })
    expect(fresh.profiles.get('not-a-key')).toBeUndefined()
  })

  it('survives a reload', async () => {
    profiles.set(KEY, { name: 'Kushagra Bansal' })
    vi.resetModules()
    const fresh = await import('./profile')
    expect(fresh.profiles.get(KEY)?.name).toBe('Kushagra Bansal')
  })

  it('removes a profile', () => {
    profiles.set(KEY, { name: 'Kushagra Bansal' })
    profiles.remove(KEY)
    expect(profiles.get(KEY)).toBeUndefined()
  })
})
