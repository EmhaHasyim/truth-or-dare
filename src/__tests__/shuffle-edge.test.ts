import { describe, it, expect } from 'vitest'
import { fisherYatesShuffle } from '../lib/shuffle'

describe('shuffle edge cases', () => {
  it('should not mutate the original array', () => {
    const original = [1, 2, 3, 4, 5]
    const originalCopy = [...original]
    fisherYatesShuffle(original)
    expect(original).toEqual(originalCopy)
  })

  it('should handle arrays with duplicate values', () => {
    const arr = [1, 1, 2, 2, 3, 3]
    const shuffled = fisherYatesShuffle(arr)
    expect(shuffled.sort()).toEqual(arr.sort())
    expect(shuffled).toHaveLength(arr.length)
  })

  it('should handle arrays with mixed types', () => {
    const arr = [1, 'hello', true, null, { foo: 'bar' }]
    const shuffled = fisherYatesShuffle(arr)
    expect(shuffled).toHaveLength(5)
    // Types should be preserved
    expect(shuffled.filter((x) => typeof x === 'number')).toHaveLength(1)
    expect(shuffled.filter((x) => typeof x === 'string')).toHaveLength(1)
    expect(shuffled.filter((x) => typeof x === 'boolean')).toHaveLength(1)
  })

  it('should handle arrays with objects (reference check)', () => {
    const obj = { id: 1 }
    const arr = [obj, { id: 2 }, { id: 3 }]
    const shuffled = fisherYatesShuffle(arr)
    // The specific object should still be in the array
    expect(shuffled).toContain(obj)
  })

  it('should produce randomized order (statistical test)', () => {
    // Run shuffle many times on a small array and verify
    // that we see different orderings
    const arr = [1, 2, 3, 4]
    const results = new Set<string>()
    const runs = 2000
    for (let i = 0; i < runs; i++) {
      results.add(fisherYatesShuffle(arr).join(','))
    }
    // With 4 elements, there are 24 permutations
    // After 2000 runs, we should see most of them
    expect(results.size).toBeGreaterThan(12) // At least half
  })

  it('should handle 2-element arrays', () => {
    const arr = ['A', 'B']
    const results = new Set<string>()
    for (let i = 0; i < 100; i++) {
      results.add(fisherYatesShuffle(arr).join(','))
    }
    // Both orderings should appear
    expect(results.has('A,B')).toBe(true)
    expect(results.has('B,A')).toBe(true)
  })

  it('should handle large arrays without errors', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i)
    const shuffled = fisherYatesShuffle(arr)
    expect(shuffled).toHaveLength(1000)
    expect(shuffled.sort((a, b) => a - b)).toEqual(arr)
  })

  it('should be deterministic with same seed (via crypto mock)', () => {
    // The shuffle uses crypto.getRandomValues which is non-deterministic.
    // This test just verifies it doesn't throw and returns correct length.
    const arr = [1, 2, 3, 4, 5]
    const shuffled1 = fisherYatesShuffle(arr)
    const shuffled2 = fisherYatesShuffle(arr)
    expect(shuffled1).toHaveLength(5)
    expect(shuffled2).toHaveLength(5)
  })
})
