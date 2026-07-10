import { describe, it, expect, vi } from 'vitest'
import { hashPassword, verifyPassword, isValidPassword } from '../lib/password'

describe('password edge cases', () => {
  describe('hashPassword', () => {
    it('should generate deterministic-format hashes (salt:key)', async () => {
      const hash = await hashPassword('testPassword123')
      expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    })

    it('should throw for non-string input', async () => {
      await expect(hashPassword(null as unknown as string)).rejects.toThrow()
      await expect(hashPassword(undefined as unknown as string)).rejects.toThrow()
    })

    it('should throw for empty password', async () => {
      await expect(hashPassword('')).rejects.toThrow()
    })

    it('should throw for password exceeding 128 chars', async () => {
      await expect(hashPassword('a'.repeat(129))).rejects.toThrow('too long')
    })

    it('should accept exactly 128 char password', async () => {
      const hash = await hashPassword('a'.repeat(128))
      expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    })
  })

  describe('verifyPassword', () => {
    it('should return false for empty password', async () => {
      expect(await verifyPassword('', 'valid:hash')).toBe(false)
    })

    it('should return false for empty stored hash', async () => {
      expect(await verifyPassword('test', '')).toBe(false)
    })

    it('should return false for malformed hash (no colon)', async () => {
      expect(await verifyPassword('test', 'invalidhash')).toBe(false)
    })

    it('should return false for malformed hash (wrong salt length)', async () => {
      expect(await verifyPassword('test', 'abc:def')).toBe(false)
    })

    it('should return false for malformed hash (non-hex chars)', async () => {
      expect(await verifyPassword('test', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef12'))
        .toBe(false)
    })

    it('should reject null/undefined password gracefully', async () => {
      expect(await verifyPassword(null as unknown as string, 'salt:key')).toBe(false)
      expect(await verifyPassword(undefined as unknown as string, 'salt:key')).toBe(false)
    })
  })

  describe('isValidPassword', () => {
    it('should reject null/undefined', () => {
      expect(isValidPassword(null as unknown as string)).toBe(false)
      expect(isValidPassword(undefined as unknown as string)).toBe(false)
    })

    it('should reject empty string', () => {
      expect(isValidPassword('')).toBe(false)
    })

    it('should reject whitespace-only string', () => {
      expect(isValidPassword('   ')).toBe(false)
    })

    it('should accept password at minimum length (8)', () => {
      expect(isValidPassword('12345678')).toBe(true)
    })

    it('should accept password at maximum length (128)', () => {
      expect(isValidPassword('a'.repeat(128))).toBe(true)
    })

    it('should reject password exceeding maximum length', () => {
      expect(isValidPassword('a'.repeat(129))).toBe(false)
    })

    it('should accept passwords with special characters', () => {
      expect(isValidPassword('!@#$%^&*()_+{}[]|\\:;"<>,.?/~`')).toBe(true)
    })

    it('should accept passwords with unicode characters', () => {
      expect(isValidPassword('パスワード123456')).toBe(true)
    })
  })
})
