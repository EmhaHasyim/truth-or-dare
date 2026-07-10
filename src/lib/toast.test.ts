import { describe, it, expect } from 'vitest'

describe('toast system', () => {
  it('should export showToast as a function', async () => {
    const mod = await import('./toast')
    expect(typeof mod.showToast).toBe('function')
  })

  it('showToast should not throw when called', async () => {
    const mod = await import('./toast')
    expect(() => mod.showToast('Test message', 'info')).not.toThrow()
  })

  it('should accept all toast types', async () => {
    const mod = await import('./toast')
    const types = ['success', 'error', 'info', 'warning'] as const
    for (const type of types) {
      expect(() => mod.showToast(`Test ${type}`, type)).not.toThrow()
    }
  })

  it('should accept custom duration', async () => {
    const mod = await import('./toast')
    expect(() => mod.showToast('Test', 'info', 5000)).not.toThrow()
  })
})
