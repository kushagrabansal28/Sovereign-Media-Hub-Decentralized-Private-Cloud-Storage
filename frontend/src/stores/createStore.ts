/** A minimal observable value for use with useSyncExternalStore. */
export function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: T) {
      if (Object.is(next, state)) return
      state = next
      listeners.forEach((l) => l())
    },
    update(fn: (prev: T) => T) {
      this.set(fn(state))
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type Store<T> = ReturnType<typeof createStore<T>>
