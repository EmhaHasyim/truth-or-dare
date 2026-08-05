import { describe, it, expect, vi, beforeEach } from 'vitest'
import { showToast, mountToastContainer } from './toast'

describe('toast system', () => {
  beforeEach(() => {
    // Clear the toast container if it exists
    const existing = document.getElementById('toast-container')
    if (existing) existing.remove()
  })

  it('should export showToast as a function', () => {
    expect(typeof showToast).toBe('function')
  })

  it('showToast should not throw when called', () => {
    expect(() => showToast('Test message', 'info')).not.toThrow()
  })

  it('should accept all toast types', () => {
    const types = ['success', 'error', 'info', 'warning'] as const
    for (const type of types) {
      expect(() => showToast(`Test ${type}`, type)).not.toThrow()
    }
  })

  it('should accept custom duration', () => {
    expect(() => showToast('Test', 'info', 5000)).not.toThrow()
  })

  it('mountToastContainer should create a container element', () => {
    mountToastContainer()
    const container = document.getElementById('toast-container')
    expect(container).toBeTruthy()
    expect(container?.tagName).toBe('DIV')
  })

  it('mountToastContainer should be idempotent', () => {
    mountToastContainer()
    const first = document.getElementById('toast-container')
    mountToastContainer()
    const second = document.getElementById('toast-container')
    // Should be the same element, not duplicated
    expect(first).toBe(second)
  })

  it('mountToastContainer should return a dispose function', () => {
    const dispose = mountToastContainer()
    expect(typeof dispose).toBe('function')
    // Calling dispose should clean up the container
    dispose?.()
    const container = document.getElementById('toast-container')
    expect(container).toBeNull()
  })

  it('should show toast after mounting container', () => {
    mountToastContainer()
    expect(() => showToast('Hello', 'success')).not.toThrow()
  })

  it('should handle multiple toasts', () => {
    mountToastContainer()
    expect(() => {
      showToast('First', 'info')
      showToast('Second', 'error')
      showToast('Third', 'warning')
    }).not.toThrow()
  })

  it('should auto-dismiss toast after duration', async () => {
    vi.useFakeTimers()
    mountToastContainer()
    showToast('Temp Message', 'info', 3000)

    const container = document.getElementById('toast-container')
    expect(container?.textContent).toContain('Temp Message')

    // Advance past the 3s duration
    await vi.advanceTimersByTimeAsync(3100)

    expect(container?.textContent).not.toContain('Temp Message')
    vi.useRealTimers()
  })
})
