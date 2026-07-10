export function fisherYatesShuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr]
  const n = result.length
  // Use Uint16Array + rejection sampling to avoid modulo bias:
  // For each i, generate random values in [0, 65535] until
  // we get one in [0, (i+1) * k - 1] where k = floor(65536 / (i+1)).
  for (let i = n - 1; i > 0; i--) {
    const range = i + 1
    const maxValid = Math.floor(65536 / range) * range
    let rand: number
    do {
      rand = crypto.getRandomValues(new Uint16Array(1))[0]
    } while (rand >= maxValid)
    const j = rand % range
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
