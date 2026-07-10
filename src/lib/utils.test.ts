import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, isValidPassword } from './password'
import { fisherYatesShuffle } from './shuffle'

describe('password hashing', () => {
  it('should hash and verify passwords correctly', async () => {
    const password = 'testPassword123'
    const hash = await hashPassword(password)
    expect(hash).not.toBe(password)
    expect(await verifyPassword(password, hash)).toBe(true)
  })

  it('should reject wrong passwords', async () => {
    const password = 'testPassword123'
    const wrongPassword = 'wrongPassword'
    const hash = await hashPassword(password)
    expect(await verifyPassword(wrongPassword, hash)).toBe(false)
  })

  it('should generate different hashes for same password', async () => {
    const password = 'testPassword123'
    const hash1 = await hashPassword(password)
    const hash2 = await hashPassword(password)
    expect(hash1).not.toBe(hash2)
  })

  it('should validate password length', () => {
    expect(isValidPassword('short')).toBe(false)
    expect(isValidPassword('validPassword123')).toBe(true)
    expect(isValidPassword('a'.repeat(129))).toBe(false)
    expect(isValidPassword('')).toBe(false)
    expect(isValidPassword(null as unknown as string)).toBe(false)
  })

  it('should handle edge cases', async () => {
    // Empty password should throw
    await expect(hashPassword('')).rejects.toThrow()
    
    // Very long password should throw (PBKDF2 max length is 128)
    await expect(hashPassword('a'.repeat(150))).rejects.toThrow()
  })
})

describe('shuffle utility', () => {
  it('should shuffle array without losing elements', () => {
    const original = [1, 2, 3, 4, 5]
    const shuffled = fisherYatesShuffle(original)
    expect(shuffled.sort()).toEqual(original)
  })

  it('should return new array reference', () => {
    const original = [1, 2, 3]
    const shuffled = fisherYatesShuffle(original)
    expect(shuffled).not.toBe(original)
  })

  it('should handle empty array', () => {
    expect(fisherYatesShuffle([])).toEqual([])
  })

  it('should handle single element array', () => {
    expect(fisherYatesShuffle([1])).toEqual([1])
  })

  it('should produce all permutations given enough runs', () => {
    const original = [1, 2, 3]
    const permutations = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const shuffled = fisherYatesShuffle(original)
      permutations.add(shuffled.join(','))
    }
    // All 6 permutations should appear across 1000 runs
    expect(permutations.size).toBe(6)
  })
})

import { serverMessageSchema, clientMessageSchema } from '../types/ws-validation'

describe('WebSocket message schema validation', () => {

  it('should validate server room_state message', () => {
    const result = serverMessageSchema.safeParse({
      type: 'room_state',
      playerId: 'abc-123',
      players: [{ id: 'abc-123', name: 'Alice', isHost: true }],
    })
    expect(result.success).toBe(true)
  })

  it('should reject server message with missing fields', () => {
    const result = serverMessageSchema.safeParse({ type: 'room_state' })
    expect(result.success).toBe(false)
  })

  it('should validate client turn_done message', () => {
    const result = clientMessageSchema.safeParse({ type: 'turn_done', status: 'completed' })
    expect(result.success).toBe(true)
  })

  it('should reject client message with invalid type', () => {
    const result = clientMessageSchema.safeParse({ type: 'invalid_type' })
    expect(result.success).toBe(false)
  })

  it('should reject client turn_done with invalid status', () => {
    const result = clientMessageSchema.safeParse({ type: 'turn_done', status: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('should validate all client message types', () => {
    const messages = [
      { type: 'start_game' },
      { type: 'select_truth' },
      { type: 'turn_done', status: 'skipped' },
    ]
    for (const msg of messages) {
      expect(clientMessageSchema.safeParse(msg).success).toBe(true)
    }
  })

  it('should validate all server message types', () => {
    const messages = [
      { type: 'game_ended' },
      { type: 'error', message: 'test error' },
    ]
    for (const msg of messages) {
      expect(serverMessageSchema.safeParse(msg).success).toBe(true)
    }
  })
})