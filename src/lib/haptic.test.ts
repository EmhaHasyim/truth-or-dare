import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { vibrate } from './haptic'

describe('vibrate', () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: vi.fn() },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('should call navigator.vibrate with default duration (15ms)', () => {
    const vibrateSpy = vi.fn()
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: vibrateSpy },
      writable: true,
      configurable: true,
    })
    vibrate()
    expect(vibrateSpy).toHaveBeenCalledWith(15)
  })

  it('should call navigator.vibrate with custom duration', () => {
    const vibrateSpy = vi.fn()
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: vibrateSpy },
      writable: true,
      configurable: true,
    })
    vibrate(50)
    expect(vibrateSpy).toHaveBeenCalledWith(50)
  })

  it('should fall back silently when vibrate is not available', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    })
    expect(() => vibrate(100)).not.toThrow()
  })

  it('should fall back silently when navigator is undefined', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    expect(() => vibrate()).not.toThrow()
  })
})
