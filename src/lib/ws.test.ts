import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getWsUrl } from './ws'

describe('getWsUrl', () => {
  const originalLocation = window.location

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  function setLocation(overrides: Partial<Location>) {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, ...overrides },
      writable: true,
    })
  }

  it('should construct ws:// URL for http:// origin', () => {
    setLocation({ protocol: 'http:', host: 'localhost:5173' })
    expect(getWsUrl('/ws/room123')).toBe('ws://localhost:5173/ws/room123')
  })

  it('should construct wss:// URL for https:// origin', () => {
    setLocation({ protocol: 'https:', host: 'example.com' })
    expect(getWsUrl('/ws/room123')).toBe('wss://example.com/ws/room123')
  })

  it('should preserve query parameters in the path', () => {
    setLocation({ protocol: 'http:', host: 'localhost:5173' })
    const url = getWsUrl('/ws/room123?name=Alice&playerId=abc-123')
    expect(url).toBe('ws://localhost:5173/ws/room123?name=Alice&playerId=abc-123')
  })

  it('should return empty string when window is undefined', () => {
    const windowSpy = vi.spyOn(globalThis, 'window', 'get')
    windowSpy.mockImplementationOnce(() => undefined as unknown as Window & typeof globalThis)
    expect(getWsUrl('/ws/test')).toBe('')
    windowSpy.mockRestore()
  })

  it('should handle host with port correctly', () => {
    setLocation({ protocol: 'https:', host: 'myapp.com:443' })
    expect(getWsUrl('/ws/game')).toBe('wss://myapp.com:443/ws/game')
  })

  it('should handle encoded special characters in path', () => {
    setLocation({ protocol: 'http:', host: 'test.dev' })
    const path = '/ws/room?name=John%20Doe'
    expect(getWsUrl(path)).toBe('ws://test.dev/ws/room?name=John%20Doe')
  })
})
