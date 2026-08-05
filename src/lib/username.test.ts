import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getStoredUsername, setStoredUsername, clearStoredUsername } from './username'

const STORAGE_KEY = 'truth-or-dare-username'

beforeEach(() => {
  localStorage.clear()
})

describe('getStoredUsername', () => {
  it('should return null when no username is stored', () => {
    expect(getStoredUsername()).toBeNull()
  })

  it('should return the stored username', () => {
    localStorage.setItem(STORAGE_KEY, 'Alice')
    expect(getStoredUsername()).toBe('Alice')
  })

  it('should return null when localStorage throws', () => {
    // happy-dom's localStorage ignores own-property overrides and global
    // Storage.prototype spies, so stub the whole object instead.
    const origStorage = globalThis.localStorage
    const stub = {
      getItem: vi.fn(() => {
        throw new Error('localStorage unavailable')
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    }
    ;(globalThis as any).localStorage = stub
    try {
      expect(getStoredUsername()).toBeNull()
    } finally {
      ;(globalThis as any).localStorage = origStorage
    }
  })

  it('should return null when window is undefined', () => {
    const origWindow = globalThis.window
    ;(globalThis as any).window = undefined
    expect(getStoredUsername()).toBeNull()
    ;(globalThis as any).window = origWindow
  })
})

describe('setStoredUsername', () => {
  it('should store the username', () => {
    setStoredUsername('Bob')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('Bob')
  })

  it('should overwrite an existing username', () => {
    localStorage.setItem(STORAGE_KEY, 'OldName')
    setStoredUsername('NewName')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('NewName')
  })

  it('should handle localStorage error gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage full')
    })
    expect(() => setStoredUsername('Charlie')).not.toThrow()
    setItemSpy.mockRestore()
  })

  it('should do nothing when window is undefined', () => {
    const origWindow = globalThis.window
    ;(globalThis as any).window = undefined
    expect(() => setStoredUsername('Dave')).not.toThrow()
    ;(globalThis as any).window = origWindow
  })
})

describe('clearStoredUsername', () => {
  it('should remove the stored username', () => {
    localStorage.setItem(STORAGE_KEY, 'Dave')
    clearStoredUsername()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('should do nothing when no username is stored', () => {
    expect(() => clearStoredUsername()).not.toThrow()
  })

  it('should handle localStorage error gracefully', () => {
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })
    expect(() => clearStoredUsername()).not.toThrow()
    removeItemSpy.mockRestore()
  })

  it('should do nothing when window is undefined', () => {
    const origWindow = globalThis.window
    ;(globalThis as any).window = undefined
    expect(() => clearStoredUsername()).not.toThrow()
    ;(globalThis as any).window = origWindow
  })
})
