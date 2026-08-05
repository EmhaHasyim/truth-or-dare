import { randomInt } from './random'

export function fisherYatesShuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr]
  const n = result.length
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
