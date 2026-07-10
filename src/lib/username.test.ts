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
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })
    expect(getStoredUsername()).toBeNull()
    getItemSpy.mockRestore()
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
})
