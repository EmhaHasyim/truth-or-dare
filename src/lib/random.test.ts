import { describe, it, expect } from 'vitest'

describe('randomInt', () => {
  let randomInt: typeof import('./random').randomInt

  it('should return 0 when maxExclusive is 1 (only valid value)', async () => {
    randomInt = (await import('./random')).randomInt
    for (let i = 0; i < 100; i++) {
      expect(randomInt(1)).toBe(0)
    }
  })

  it('should return values in [0, maxExclusive)', async () => {
    randomInt = (await import('./random')).randomInt
    for (const max of [2, 5, 10, 100]) {
      for (let i = 0; i < 500; i++) {
        const val = randomInt(max)
        expect(val).toBeGreaterThanOrEqual(0)
        expect(val).toBeLessThan(max)
      }
    }
  })

  it('should throw for maxExclusive <= 0', async () => {
    randomInt = (await import('./random')).randomInt
    expect(() => randomInt(0)).toThrow('maxExclusive must be > 0')
    expect(() => randomInt(-1)).toThrow('maxExclusive must be > 0')
  })

  it('should produce a distribution covering all values', async () => {
    randomInt = (await import('./random')).randomInt
    const max = 6
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      seen.add(randomInt(max))
    }
    // With 6 values and 1000 samples, we should see all 6
    for (let i = 0; i < max; i++) {
      expect(seen.has(i)).toBe(true)
    }
  })
})
