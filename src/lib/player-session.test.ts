import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storePlayerSession, getStoredPlayerSession } from './player-session'

const ROOM_ID = 'room-123'
const SESSION_KEY = 'tod-player-session-room-123'

beforeEach(() => {
  sessionStorage.clear()
})

describe('storePlayerSession', () => {
  it('should store session data in sessionStorage', () => {
    storePlayerSession(ROOM_ID, { playerId: 'p1', playerName: 'Alice' })
    const raw = sessionStorage.getItem(SESSION_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual({ playerId: 'p1', playerName: 'Alice' })
  })

  it('should overwrite existing session for same room', () => {
    storePlayerSession(ROOM_ID, { playerId: 'p1', playerName: 'Alice' })
    storePlayerSession(ROOM_ID, { playerId: 'p2', playerName: 'Bob' })
    const raw = sessionStorage.getItem(SESSION_KEY)
    expect(JSON.parse(raw!)).toEqual({ playerId: 'p2', playerName: 'Bob' })
  })

  it('should do nothing if window is undefined', () => {
    const origWindow = globalThis.window
    ;(globalThis as any).window = undefined
    expect(() => storePlayerSession(ROOM_ID, { playerId: 'p1', playerName: 'Alice' })).not.toThrow()
    ;(globalThis as any).window = origWindow
  })

  it('should do nothing if roomId is empty', () => {
    expect(() => storePlayerSession('', { playerId: 'p1', playerName: 'Alice' })).not.toThrow()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('should do nothing if session is invalid', () => {
    expect(() => storePlayerSession(ROOM_ID, null as any)).not.toThrow()
    expect(() => storePlayerSession(ROOM_ID, undefined as any)).not.toThrow()
    expect(() => storePlayerSession(ROOM_ID, { playerId: '', playerName: '' })).not.toThrow()
  })

  it('should handle sessionStorage errors gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full')
    })
    expect(() => storePlayerSession(ROOM_ID, { playerId: 'p1', playerName: 'Alice' })).not.toThrow()
    setItemSpy.mockRestore()
  })
})

describe('getStoredPlayerSession', () => {
  it('should return null when no session exists', () => {
    expect(getStoredPlayerSession(ROOM_ID)).toBeNull()
  })

  it('should return stored session data', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ playerId: 'p1', playerName: 'Alice' }))
    const result = getStoredPlayerSession(ROOM_ID)
    expect(result).toEqual({ playerId: 'p1', playerName: 'Alice' })
  })

  it('should return null if window is undefined', () => {
    const origWindow = globalThis.window
    ;(globalThis as any).window = undefined
    expect(getStoredPlayerSession(ROOM_ID)).toBeNull()
    ;(globalThis as any).window = origWindow
  })

  it('should return null if roomId is empty', () => {
    expect(getStoredPlayerSession('')).toBeNull()
  })

  it('should return null for malformed JSON', () => {
    sessionStorage.setItem(SESSION_KEY, '{bad json}')
    expect(getStoredPlayerSession(ROOM_ID)).toBeNull()
  })

  it('should return null for missing fields', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ foo: 'bar' }))
    expect(getStoredPlayerSession(ROOM_ID)).toBeNull()
  })

  it('should handle sessionStorage errors gracefully', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(getStoredPlayerSession(ROOM_ID)).toBeNull()
    getItemSpy.mockRestore()
  })
})
