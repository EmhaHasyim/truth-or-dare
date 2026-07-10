import { describe, it, expect } from 'vitest'
import {
  MAX_PLAYERS,
  MAX_ROUNDS,
  MAX_RECONNECT_ATTEMPTS,
  WS_RECONNECT_DELAY,
  CODE_CHARS,
  CODE_LENGTH,
  MAX_CODE_GENERATION_RETRIES,
  EMPTY_ROOM_TIMEOUT,
  EMPTY_ROOM_CHECK_INTERVAL,
  TURN_TIMEOUT_MS,
} from '../constants'

describe('constants consistency', () => {
  it('MAX_PLAYERS should be a positive integer', () => {
    expect(MAX_PLAYERS).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_PLAYERS)).toBe(true)
  })

  it('MAX_ROUNDS should be non-negative (0 = unlimited)', () => {
    expect(MAX_ROUNDS).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(MAX_ROUNDS)).toBe(true)
  })

  it('MAX_RECONNECT_ATTEMPTS should be a positive integer', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_RECONNECT_ATTEMPTS)).toBe(true)
  })

  it('WS_RECONNECT_DELAY should be a positive integer (milliseconds)', () => {
    expect(WS_RECONNECT_DELAY).toBeGreaterThan(0)
    expect(Number.isInteger(WS_RECONNECT_DELAY)).toBe(true)
  })

  describe('room code system', () => {
    it('CODE_CHARS should contain unambiguous characters', () => {
      expect(CODE_CHARS.length).toBeGreaterThanOrEqual(30)
      // Excludes confusable characters
      expect(CODE_CHARS).not.toContain('0') // confusable with O
      expect(CODE_CHARS).not.toContain('1') // confusable with I
      expect(CODE_CHARS).not.toContain('I') // confusable with 1
      expect(CODE_CHARS).not.toContain('O') // confusable with 0
    })

    it('CODE_CHARS should only contain uppercase letters and digits', () => {
      expect(CODE_CHARS).toMatch(/^[A-Z2-9]+$/)
    })

    it('CODE_LENGTH should produce codes with good entropy', () => {
      expect(CODE_LENGTH).toBeGreaterThanOrEqual(4)
      expect(Number.isInteger(CODE_LENGTH)).toBe(true)
      const entropy = Math.log2(Math.pow(CODE_CHARS.length, CODE_LENGTH))
      expect(entropy).toBeGreaterThan(20)
    })

    it('MAX_CODE_GENERATION_RETRIES should be sufficient for collision handling', () => {
      expect(MAX_CODE_GENERATION_RETRIES).toBeGreaterThanOrEqual(3)
      expect(Number.isInteger(MAX_CODE_GENERATION_RETRIES)).toBe(true)
    })
  })

  describe('room cleanup timers', () => {
    it('EMPTY_ROOM_TIMEOUT should be at least 1 minute', () => {
      expect(EMPTY_ROOM_TIMEOUT).toBeGreaterThanOrEqual(60_000)
    })

    it('EMPTY_ROOM_CHECK_INTERVAL should be less than EMPTY_ROOM_TIMEOUT', () => {
      expect(EMPTY_ROOM_CHECK_INTERVAL).toBeLessThan(EMPTY_ROOM_TIMEOUT)
      expect(Number.isInteger(EMPTY_ROOM_CHECK_INTERVAL)).toBe(true)
    })
  })

  describe('turn timeout', () => {
    it('TURN_TIMEOUT_MS should be a reasonable timeout (10s-5m)', () => {
      expect(TURN_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
      expect(TURN_TIMEOUT_MS).toBeLessThanOrEqual(300_000)
      expect(Number.isInteger(TURN_TIMEOUT_MS)).toBe(true)
    })
  })
})
